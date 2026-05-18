// server.js – SINGLE BACKEND FILE FOR SANKALP DIGITAL PATHSHALA
// ======================== IMPORTS & CONFIG ========================
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const xss = require('xss');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

// ---------- Environment variables ----------
const {
  MONGODB_URI,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  JWT_SECRET,
  GEMINI_API_KEY,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  PORT = 3000
} = process.env;

// ---------- Cloudinary config ----------
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

// ---------- Gemini AI ----------
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ---------- Express app ----------
const app = express();

// ---------- Security middlewares ----------
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ---------- Static files ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// ---------- Global rate limiter ----------
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later.'
});
app.use(globalLimiter);

// ---------- Mongoose connection (optimized for serverless) ----------
let cachedDb = null;
async function connectDB() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  const conn = await mongoose.connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  });
  cachedDb = conn;
  console.log('MongoDB connected');
  return conn;
}

// ======================== DATABASE MODELS ========================

// --- Contact Inquiry ---
const inquirySchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true },
  mobile: { type: String, required: true },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['new', 'contacted', 'closed'], default: 'new' },
  createdAt: { type: Date, default: Date.now }
});
inquirySchema.index({ status: 1, createdAt: -1 });
const Inquiry = mongoose.model('Inquiry', inquirySchema);

// --- AI Lead (from Sankalp Sathi) ---
const aiLeadSchema = new mongoose.Schema({
  firstName: String,
  class: String,
  interest: String,
  phone: String,
  city: String,
  parentName: String,
  email: String,
  aiSummary: String,
  leadScore: { type: Number, min: 0, max: 100 },
  status: { type: String, enum: ['pending', 'contacted', 'converted'], default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
aiLeadSchema.index({ status: 1, leadScore: -1 });
const AILead = mongoose.model('AILead', aiLeadSchema);

// --- AI Question (history) ---
const aiQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['text', 'image', 'pdf'], required: true },
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now }
});
const AIQuestion = mongoose.model('AIQuestion', aiQuestionSchema);

// --- Result ---
const resultSchema = new mongoose.Schema({
  registrationNumber: { type: String, required: true, unique: true },
  studentName: { type: String, required: true },
  fatherName: { type: String, required: true },
  dob: { type: Date, required: true },
  class: { type: String, required: true },
  session: { type: String, required: true },
  subjects: [{ subject: String, marksObtained: Number, maxMarks: Number }],
  percentage: { type: Number, required: true },
  grade: { type: String, required: true },
  remarks: { type: String, default: '' },
  published: { type: Boolean, default: false },
  issueDate: { type: Date, default: Date.now }
});
resultSchema.index({ registrationNumber: 1 });
resultSchema.index({ published: 1 });
const Result = mongoose.model('Result', resultSchema);

// --- Event ---
const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  image: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', eventSchema);

// --- Gallery item ---
const gallerySchema = new mongoose.Schema({
  imageUrl: { type: String, required: true },
  caption: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Gallery = mongoose.model('Gallery', gallerySchema);

// --- Program ---
const programSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  features: [String],
  image: { type: String, default: '' }
});
const Program = mongoose.model('Program', programSchema);

// ======================== HELPER MIDDLEWARES ========================

// Admin brute-force rate limiter (login only)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

// Admin authentication middleware
function adminAuth(req, res, next) {
  const token = req.cookies?.admin_token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error();
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// XSS sanitization for objects
function sanitize(obj) {
  for (let key in obj) {
    if (typeof obj[key] === 'string') {
      obj[key] = xss(obj[key]);
    }
  }
  return obj;
}

// Prompt injection filtering (basic)
const forbiddenPatterns = [/system:/i, /ignore previous/i, /pretend/i];
function filterPrompt(text) {
  let filtered = text;
  forbiddenPatterns.forEach(p => {
    filtered = filtered.replace(p, '');
  });
  return filtered;
}

// Multer upload (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/pdf'
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});

// Cloudinary upload helper
async function uploadToCloudinary(buffer, folder = 'sankalp') {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: 'auto' },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
}

// ======================== VALIDATION SCHEMAS (Zod) ========================

const contactSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  mobile: z.string().regex(/^[0-9+\- ]{7,15}$/),
  subject: z.string().min(2).max(200),
  message: z.string().min(5).max(2000)
});

const resultCheckSchema = z.object({
  registrationNumber: z.string().min(1).max(20),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

// ======================== ROUTES ========================

// ---------- Public API: AI Question Solver ----------
app.post('/api/solve-question', upload.single('file'), async (req, res) => {
  try {
    await connectDB();
    const { type, question } = req.body;
    if (!type || !['text', 'image', 'pdf'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Must be text, image, or pdf.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    let prompt = 'You are a helpful academic tutor. Provide a detailed step-by-step explanation. Answer in the same language as the question.';

    let result;
    if (type === 'text') {
      if (!question) return res.status(400).json({ error: 'Question text required.' });
      const filteredQuestion = filterPrompt(xss(question));
      const fullPrompt = `${prompt}\n\nQuestion: ${filteredQuestion}`;
      result = await model.generateContent(fullPrompt);
    } else if (type === 'image') {
      if (!req.file) return res.status(400).json({ error: 'Image file required.' });
      const imagePart = {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype
        }
      };
      result = await model.generateContent([prompt, imagePart]);
    } else if (type === 'pdf') {
      if (!req.file) return res.status(400).json({ error: 'PDF file required.' });
      const pdfPart = {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: 'application/pdf'
        }
      };
      result = await model.generateContent([prompt, pdfPart]);
    }

    const response = await result.response;
    const answer = response.text();

    // Store history
    const aiQ = new AIQuestion({
      type,
      question: type === 'text' ? question : `[${type} upload]`,
      answer
    });
    await aiQ.save();

    res.json({ success: true, answer });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AI processing failed.' });
  }
});

// ---------- Public API: Sankalp Sathi Chatbot ----------
app.post('/api/chat', async (req, res) => {
  try {
    await connectDB();
    let { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });

    message = filterPrompt(xss(message));

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const systemPrompt = `You are Sankalp Sathi, a warm, friendly academic mentor for Sankalp Digital Pathshala. Answer questions about admissions, courses, AI learning, and general academics. Keep replies concise, helpful, and human-like. Use Hinglish when appropriate. If someone asks for help with admission, gently collect: name, class, interest, phone, city, parent name, email. After collecting, say "Thanks! Our team will contact you soon."`;

    const fullPrompt = `${systemPrompt}\nUser: ${message}`;
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const reply = response.text();

    res.json({ reply, sessionId: sessionId || 'default' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Chatbot error.' });
  }
});

// ----- Lead capture (from frontend after AI conversation) -----
app.post('/api/lead', async (req, res) => {
  try {
    await connectDB();
    const schema = z.object({
      firstName: z.string().min(1),
      class: z.string().min(1),
      interest: z.string().min(1),
      phone: z.string().min(7),
      city: z.string().optional(),
      parentName: z.string().optional(),
      email: z.string().email().optional()
    });
    const data = schema.parse(req.body);
    sanitize(data);

    // Generate AI summary & lead score using Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const summaryPrompt = `Based on the following lead info, generate a short summary and a lead score from 0 to 100 (where 100 is highest conversion potential). Return ONLY a JSON object: { "summary": "...", "score": number }. Info: ${JSON.stringify(data)}`;
    const result = await model.generateContent(summaryPrompt);
    const text = (await result.response).text();
    let aiData = { summary: '', score: 50 };
    try {
      const extracted = JSON.parse(text.match(/\{.*\}/s)[0]);
      aiData.summary = extracted.summary;
      aiData.score = Math.min(100, Math.max(0, Number(extracted.score)));
    } catch (e) { /* ignore */ }

    const lead = new AILead({
      ...data,
      aiSummary: aiData.summary,
      leadScore: aiData.score
    });
    await lead.save();

    res.json({ success: true, message: 'Lead captured successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid lead data.' });
  }
});

// ---------- Public API: Contact Form ----------
app.post('/api/contact', async (req, res) => {
  try {
    await connectDB();
    const data = contactSchema.parse(req.body);
    sanitize(data);
    const inquiry = new Inquiry(data);
    await inquiry.save();
    res.json({ success: true, message: 'Thank you for contacting us! We will get back soon.' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    res.status(500).json({ error: 'Could not submit inquiry.' });
  }
});

// ---------- Public API: Result Checker ----------
app.post('/api/result/check', async (req, res) => {
  try {
    await connectDB();
    const data = resultCheckSchema.parse(req.body);
    const { registrationNumber, dob } = data;

    const result = await Result.findOne({ registrationNumber, published: true });
    if (!result) {
      return res.status(404).json({ error: 'Result not found or not published yet.' });
    }

    const resultDob = new Date(result.dob).toISOString().split('T')[0];
    if (resultDob !== dob) {
      return res.status(400).json({ error: 'Invalid date of birth.' });
    }

    res.json({ success: true, result });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input.' });
    res.status(500).json({ error: 'Server error.' });
  }
});

// ---------- Admin Authentication ----------
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = adminLoginSchema.parse(req.body);
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ email, role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
    res.cookie('admin_token', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input' });
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true });
});

app.get('/api/admin/check-auth', adminAuth, (req, res) => {
  res.json({ authenticated: true, email: req.admin.email });
});

// ---------- Admin Dashboard Stats ----------
app.get('/api/admin/dashboard', adminAuth, async (req, res) => {
  try {
    await connectDB();
    const [totalChats, totalSolves, totalLeads, totalInquiries, totalResults] = await Promise.all([
      AIQuestion.countDocuments(),
      AIQuestion.countDocuments(),
      AILead.countDocuments(),
      Inquiry.countDocuments(),
      Result.countDocuments()
    ]);

    const newInquiries = await Inquiry.countDocuments({ status: 'new' });
    const contactedInquiries = await Inquiry.countDocuments({ status: 'contacted' });

    res.json({
      stats: {
        totalChats,
        totalSolves,
        totalLeads,
        totalInquiries,
        newInquiries,
        contactedInquiries,
        totalResults
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Dashboard error' });
  }
});

// ---------- Inquiries CRUD ----------
app.get('/api/admin/inquiries', adminAuth, async (req, res) => {
  await connectDB();
  const inquiries = await Inquiry.find().sort({ createdAt: -1 });
  res.json(inquiries);
});

app.patch('/api/admin/inquiries/:id', adminAuth, async (req, res) => {
  await connectDB();
  const { status } = req.body;
  if (!['new', 'contacted', 'closed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const inquiry = await Inquiry.findByIdAndUpdate(req.params.id, { status }, { new: true });
  res.json(inquiry);
});

app.delete('/api/admin/inquiries/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Inquiry.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Leads CRUD ----------
app.get('/api/admin/leads', adminAuth, async (req, res) => {
  await connectDB();
  const leads = await AILead.find().sort({ createdAt: -1 });
  res.json(leads);
});

app.patch('/api/admin/leads/:id', adminAuth, async (req, res) => {
  await connectDB();
  const { status } = req.body;
  if (!['pending', 'contacted', 'converted'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const lead = await AILead.findByIdAndUpdate(req.params.id, { status }, { new: true });
  res.json(lead);
});

app.delete('/api/admin/leads/:id', adminAuth, async (req, res) => {
  await connectDB();
  await AILead.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Results CRUD ----------
app.get('/api/admin/results', adminAuth, async (req, res) => {
  await connectDB();
  const results = await Result.find().sort({ createdAt: -1 });
  res.json(results);
});

app.post('/api/admin/results', adminAuth, async (req, res) => {
  await connectDB();
  const schema = z.object({
    registrationNumber: z.string(),
    studentName: z.string(),
    fatherName: z.string(),
    dob: z.string(),
    class: z.string(),
    session: z.string(),
    subjects: z.array(z.object({ subject: z.string(), marksObtained: z.number(), maxMarks: z.number() })),
    percentage: z.number(),
    grade: z.string(),
    remarks: z.string().optional(),
    published: z.boolean().optional(),
    issueDate: z.string().optional()
  });
  const data = schema.parse(req.body);
  data.dob = new Date(data.dob);
  if (data.issueDate) data.issueDate = new Date(data.issueDate);
  const result = new Result(data);
  await result.save();
  res.json(result);
});

app.put('/api/admin/results/:id', adminAuth, async (req, res) => {
  await connectDB();
  const result = await Result.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  res.json(result);
});

app.delete('/api/admin/results/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Result.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Events CRUD ----------
app.get('/api/admin/events', adminAuth, async (req, res) => {
  await connectDB();
  const events = await Event.find().sort({ date: -1 });
  res.json(events);
});

app.post('/api/admin/events', adminAuth, upload.single('image'), async (req, res) => {
  await connectDB();
  let imageUrl = '';
  if (req.file) {
    imageUrl = await uploadToCloudinary(req.file.buffer, 'sankalp/events');
  }
  const { title, description, date } = req.body;
  const event = new Event({ title, description, date, image: imageUrl });
  await event.save();
  res.json(event);
});

app.put('/api/admin/events/:id', adminAuth, upload.single('image'), async (req, res) => {
  await connectDB();
  const update = { ...req.body };
  if (req.file) {
    update.image = await uploadToCloudinary(req.file.buffer, 'sankalp/events');
  }
  const event = await Event.findByIdAndUpdate(req.params.id, update, { new: true });
  res.json(event);
});

app.delete('/api/admin/events/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Event.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Gallery CRUD ----------
app.get('/api/admin/gallery', adminAuth, async (req, res) => {
  await connectDB();
  const items = await Gallery.find().sort({ createdAt: -1 });
  res.json(items);
});

app.post('/api/admin/gallery', adminAuth, upload.single('image'), async (req, res) => {
  await connectDB();
  if (!req.file) return res.status(400).json({ error: 'Image required' });
  const imageUrl = await uploadToCloudinary(req.file.buffer, 'sankalp/gallery');
  const { caption } = req.body;
  const gallery = new Gallery({ imageUrl, caption });
  await gallery.save();
  res.json(gallery);
});

app.delete('/api/admin/gallery/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Gallery.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Programs CRUD ----------
app.get('/api/admin/programs', adminAuth, async (req, res) => {
  await connectDB();
  const programs = await Program.find().sort({ title: 1 });
  res.json(programs);
});

app.post('/api/admin/programs', adminAuth, async (req, res) => {
  await connectDB();
  const program = new Program(req.body);
  await program.save();
  res.json(program);
});

app.put('/api/admin/programs/:id', adminAuth, async (req, res) => {
  await connectDB();
  const program = await Program.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(program);
});

app.delete('/api/admin/programs/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Program.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- Public GET for frontend pages (dynamic data) ----------
app.get('/api/public/events', async (req, res) => {
  await connectDB();
  const events = await Event.find().sort({ date: 1 });
  res.json(events);
});

app.get('/api/public/gallery', async (req, res) => {
  await connectDB();
  const gallery = await Gallery.find().sort({ createdAt: -1 });
  res.json(gallery);
});

app.get('/api/public/programs', async (req, res) => {
  await connectDB();
  const programs = await Program.find();
  res.json(programs);
});

// ---------- Fallback to index.html for client-side routing ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ======================== ERROR HANDLING ========================
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === 'Invalid file type') {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// ======================== START SERVER ========================
if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  });
}

// Export for Vercel serverless
module.exports = app;
