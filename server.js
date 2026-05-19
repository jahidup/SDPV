// server.js – FINAL PRODUCTION BACKEND (v13)
// OpenRouter streaming, Gemini fallback, MongoDB Atlas, Cloudinary, all CRUD
// Updated system prompt to ensure academic question answering

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const xss = require('xss');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');

// ---------- ENVIRONMENT VARIABLES ----------
const {
  MONGODB_URI,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  JWT_SECRET,
  GEMINI_API_KEY,
  OPENROUTER_API_KEY,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  PORT = 3000
} = process.env;

// ---------- CLOUDINARY ----------
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET
});

// ---------- GEMINI ----------
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ---------- EXPRESS ----------
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  message: 'Too many requests, please try again later.'
});
app.use(globalLimiter);

// ---------- MONGOOSE ----------
let cachedDb = null;
async function connectDB() {
  if (cachedDb && mongoose.connection.readyState === 1) return cachedDb;
  const conn = await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
  });
  cachedDb = conn;
  console.log('MongoDB connected');
  return conn;
}

// ======================== DATABASE MODELS ========================

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

const aiQuestionSchema = new mongoose.Schema({
  type: { type: String, enum: ['text', 'image', 'pdf'], required: true },
  question: String,
  answer: String,
  createdAt: { type: Date, default: Date.now }
});
const AIQuestion = mongoose.model('AIQuestion', aiQuestionSchema);

const resultSchema = new mongoose.Schema({
  registrationNumber: { type: String, required: true, unique: true },
  studentName: { type: String, required: true },
  fatherName: { type: String, required: true },
  dob: { type: Date, required: true },
  grade: { type: String, default: '' },
  remarks: { type: String, default: '' },
  published: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
resultSchema.index({ registrationNumber: 1 });
const Result = mongoose.model('Result', resultSchema);

const eventSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  date: { type: Date, required: true },
  image: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Event = mongoose.model('Event', eventSchema);

const gallerySchema = new mongoose.Schema({
  imageUrl: { type: String, required: true },
  caption: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Gallery = mongoose.model('Gallery', gallerySchema);

const programSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String, required: true },
  features: [String],
  image: { type: String, default: '' }
});
const Program = mongoose.model('Program', programSchema);

// ======================== MIDDLEWARES ========================

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' }
});

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

function sanitize(obj) {
  for (let key in obj) {
    if (typeof obj[key] === 'string') obj[key] = xss(obj[key]);
  }
  return obj;
}

const forbiddenPatterns = [/system:/i, /ignore previous/i, /pretend/i, /bypass/i];
function filterPrompt(text) {
  let filtered = text;
  forbiddenPatterns.forEach(p => (filtered = filtered.replace(p, '')));
  return filtered;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Invalid file type'), false);
  }
});

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

// ======================== VALIDATION SCHEMAS ========================

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

// ======================== UPDATED SYSTEM PROMPT ========================

const SYSTEM_PROMPT = `You are Sankalp Sathi, a friendly and warm AI academic mentor for Sankalp Digital Pathshala, run by Sankalp Shiksha Foundation. Your job is to help students learn. You can answer any academic question, explain concepts, solve problems, and provide study tips. You also know about the foundation, its mission, courses, and admission process. When a user asks an academic question, focus on giving a clear, step‑by‑step explanation. When a user asks about the foundation or admissions, share relevant information.

ABOUT THE FOUNDATION:
Sankalp Shiksha Foundation's mission is "हमारा संकल्प, सामाजिक उत्थान व कायाकल्प" (Our Pledge: Social Upliftment and Transformation). It works to close the digital divide between villages and cities. It was founded on November 18, 2020, and is headquartered in Gorakhpur, Uttar Pradesh. The learning center, Sankalp Digital Pathshala, is in Salemgarh, Tamkuhi, Kushinagar. Founders: Abhishek Kumar (B.Tech from NIT, engineer) and Vikas Kumar (B.Tech CSE from NIT Hamirpur, technical lead). They started the Pathshala to provide digital education, job‑ready skills, and holistic community upliftment. Milestones include starting as COVID‑19 relief in 2020, launching the first digital classroom in 2021, AI & Robotics Labs in 2022, Rojgaar Buddy skilling program in 2023, Doordarshan recognition in 2024, 312+ trainees and 40+ placements in 2025, and expanding to neighboring districts in 2026. The Rojgaar Buddy program trains rural youth in Web Development, Graphic Design, Excel, Digital Marketing, and Communication. Community programs include cleanliness drives, road safety rallies, flood relief, and more.

CONTACT: info@sankalppathshala.com, +91 8055698328. Donate at sankalpshiksha.com/donate.

AI DEVELOPER: This AI assistant was developed by NexGenAiTech, founded by Jahid, specializing in AI and full‑stack development. Website: https://nexgenaitech.online. Contact Jahid at +91 8055698328.

RESPONSE RULES (STRICT):
- Use only plain paragraphs. Do not use markdown, bold, italics, headings, tables, lists, or code blocks.
- Write naturally like you are talking to a friend. Use simple, clear sentences.
- Break information into short paragraphs (2‑4 sentences each). Use a blank line between paragraphs.
- Always answer in the same language the user uses: Hindi, English, or Hinglish.
- When someone asks for admission or course help, gently collect: name, class, interest, phone, city, parent name, email. Then tell them our team will contact them soon.
- If you don't know something, say so honestly and suggest contacting the support team.`;

// ======================== ROUTES ========================

// ---------- AI QUESTION SOLVER (Gemini) ----------
app.post('/api/solve-question', upload.single('file'), async (req, res) => {
  try {
    await connectDB();
    const { type, question } = req.body;
    if (!type || !['text', 'image', 'pdf'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type. Must be text, image, or pdf.' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const basePrompt = 'You are a helpful academic tutor. Provide a detailed step-by-step explanation. Answer in the same language as the question.';

    let result;
    if (type === 'text') {
      if (!question) return res.status(400).json({ error: 'Question text required.' });
      const filteredQuestion = filterPrompt(xss(question));
      result = await model.generateContent(`${basePrompt}\n\nQuestion: ${filteredQuestion}`);
    } else if (type === 'image') {
      if (!req.file) return res.status(400).json({ error: 'Image file required.' });
      const imagePart = {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: req.file.mimetype
        }
      };
      result = await model.generateContent([basePrompt, imagePart]);
    } else if (type === 'pdf') {
      if (!req.file) return res.status(400).json({ error: 'PDF file required.' });
      const pdfPart = {
        inlineData: {
          data: req.file.buffer.toString('base64'),
          mimeType: 'application/pdf'
        }
      };
      result = await model.generateContent([basePrompt, pdfPart]);
    }

    const response = await result.response;
    const answer = response.text();

    const aiQ = new AIQuestion({
      type,
      question: type === 'text' ? question : `[${type} upload]`,
      answer
    });
    await aiQ.save();

    res.json({ success: true, answer });
  } catch (err) {
    console.error('AI Solver Error:', err);
    res.status(500).json({ error: 'AI processing failed.' });
  }
});

// ---------- STREAMING CHATBOT (OpenRouter with Gemini fallback) ----------
app.post('/api/chat', async (req, res) => {
  try {
    await connectDB();
    let { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });
    message = filterPrompt(xss(message));

    // If no OpenRouter key, fallback to Gemini non-streaming
    if (!OPENROUTER_API_KEY) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nUser: ${message}`);
      const reply = (await result.response).text();
      // Ensure plain paragraph formatting for Gemini response (may still contain markdown)
      return res.send(reply.replace(/\*\*|__/g, '').replace(/\*/g, '').replace(/#/g, ''));
    }

    // Set streaming headers
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://www.sankalpdigitalpathshala.online',
        'X-Title': 'Sankalp Digital Pathshala'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b:free',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: message }
        ],
        stream: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter error:', errorText);
      res.status(500).send('AI service temporarily unavailable.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const sendChunk = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.replace('data: ', '').trim();
              if (data === '[DONE]') {
                res.end();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  res.write(content);
                }
              } catch (e) { /* ignore malformed chunks */ }
            }
          }
        }
      } catch (err) {
        console.error('Stream error:', err);
        res.end();
      }
    };

    sendChunk();
  } catch (err) {
    console.error('Chatbot Error:', err);
    res.status(500).send('I am having a small technical issue. Please try again.');
  }
});

// ---------- LEAD CAPTURE ----------
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

    let aiSummary = '';
    let leadScore = 50;

    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const summaryPrompt = `Based on the following lead info, generate a short summary and a lead score from 0 to 100 (where 100 is highest conversion potential). Return ONLY a JSON object: { "summary": "...", "score": number }. Info: ${JSON.stringify(data)}`;
      const result = await model.generateContent(summaryPrompt);
      const text = (await result.response).text();
      const extracted = JSON.parse(text.match(/\{.*\}/s)[0]);
      aiSummary = extracted.summary || '';
      leadScore = Math.min(100, Math.max(0, Number(extracted.score) || 50));
    } catch (e) { /* use defaults */ }

    const lead = new AILead({ ...data, aiSummary, leadScore });
    await lead.save();
    res.json({ success: true, message: 'Lead captured successfully.' });
  } catch (err) {
    res.status(400).json({ error: 'Invalid lead data.' });
  }
});

// ---------- CONTACT FORM ----------
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

// ---------- PUBLIC RESULT CHECKER ----------
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

// ---------- ADMIN AUTH ----------
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

// ---------- ADMIN DASHBOARD ----------
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

    res.json({
      stats: { totalChats, totalSolves, totalLeads, totalInquiries, totalResults }
    });
  } catch (err) {
    res.status(500).json({ error: 'Dashboard error' });
  }
});

// ---------- INQUIRIES CRUD ----------
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

// ---------- LEADS CRUD ----------
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

// ---------- RESULTS CRUD (SIMPLIFIED) ----------
app.get('/api/admin/results', adminAuth, async (req, res) => {
  await connectDB();
  const results = await Result.find().sort({ createdAt: -1 });
  res.json(results);
});

app.post('/api/admin/results', adminAuth, async (req, res) => {
  await connectDB();
  const { registrationNumber, studentName, fatherName, dob, grade, remarks, published } = req.body;
  if (!registrationNumber || !studentName || !fatherName || !dob) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    const result = new Result({
      registrationNumber,
      studentName,
      fatherName,
      dob: new Date(dob),
      grade: grade || '',
      remarks: remarks || '',
      published: published || false
    });
    await result.save();
    res.json(result);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Duplicate registration number' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/results/:id', adminAuth, async (req, res) => {
  await connectDB();
  const { registrationNumber, studentName, fatherName, dob, grade, remarks, published } = req.body;
  try {
    const result = await Result.findByIdAndUpdate(
      req.params.id,
      { registrationNumber, studentName, fatherName, dob: new Date(dob), grade, remarks, published },
      { new: true, runValidators: true }
    );
    res.json(result);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Duplicate registration number' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/results/:id', adminAuth, async (req, res) => {
  await connectDB();
  await Result.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

// ---------- EVENTS CRUD ----------
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

// ---------- GALLERY CRUD ----------
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

// ---------- PROGRAMS CRUD ----------
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

// ---------- PUBLIC DATA ----------
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

// ---------- FALLBACK ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- ERROR HANDLER ----------
app.use((err, req, res, next) => {
  console.error(err);
  if (err.message === 'Invalid file type') return res.status(400).json({ error: 'Invalid file type' });
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large' });
  res.status(500).json({ error: 'Internal server error' });
});

// ---------- START ----------
if (require.main === module) {
  connectDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  });
}

module.exports = app;
