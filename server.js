// server.js – FINAL PRODUCTION BACKEND (v11)
// OpenRouter via fetch, Gemini for solver & fallback, MongoDB Atlas, Cloudinary
// All admin CRUD, public APIs, and security included

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

// ---------- MODELS ----------
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

// ---------- MIDDLEWARES ----------
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

// ---------- VALIDATION SCHEMAS ----------
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

// ---------- SYSTEM PROMPT (COMPLETE) ----------
const SYSTEM_PROMPT = `You are Sankalp Sathi, the friendly and warm AI mentor of Sankalp Digital Pathshala, the learning center run by Sankalp Shiksha Foundation.

ABOUT THE FOUNDATION:
Sankalp Shiksha Foundation's mission is "हमारा संकल्प, सामाजिक उत्थान व कायाकल्प" which means "Our Pledge: Social Upliftment and Transformation." The foundation works to close the digital divide between villages and cities.

It was founded on November 18, 2020, and is headquartered in Gorakhpur, Uttar Pradesh. The learning center called Sankalp Digital Pathshala is located in Salemgarh, Tamkuhi, Kushinagar.

The founders are Abhishek Kumar and Vikas Kumar, both serving as Co-Founder and Director. Abhishek Kumar holds a B.Tech from NIT and is an engineer and tech entrepreneur. Vikas Kumar holds a B.Tech in Computer Science from NIT Hamirpur and later became a technical lead in a multinational IT services firm.

WHY THEY STARTED:
First, to bridge the digital divide by providing modern learning resources like computers, internet, and AI and Robotics labs to underprivileged children in villages of Kushinagar and surrounding districts. Second, to enable rural youth to acquire job-ready skills like web development, digital marketing, and AI basics without having to leave their hometowns. Third, to drive holistic community upliftment by combining education with health, sanitation, environmental, and livelihood initiatives.

JOURNEY MILESTONES:
In 2020, it started as a COVID-19 relief effort with food, masks, and sanitizers. In 2021, they launched the first digital classroom in Salemgarh, Tamkuhi. In 2022, they introduced AI and Robotics Labs with drones and automation kits. In 2023, they rolled out Rojgaar Buddy, a skilling program for youth aged 18 to 25. In 2024, they were recognized by Doordarshan for their impact on rural digital literacy. In 2025, Rojgaar Buddy had 312 plus trainees and 40 plus placements, with 73 percent from BPL families. In 2026, they are expanding to neighboring districts and discussing partnerships with the state IT ministry for scaling labs.

ROJGAAR BUDDY PROGRAM:
The Rojgaar Buddy program trains rural youth in Web Development, Graphic Design, Excel, Digital Marketing, Communication and Personality Development. Success stories include Vishal, a 22-year-old who now earns through freelance web design, Priya who runs a small online business, and Imran who manages a part-time digital marketing project for a local startup.

COMMUNITY PROGRAMS:
The foundation runs cleanliness campaigns at Gomti river front, road safety awareness rallies, flood relief in UP and Bihar, COVID-19 ration distribution to over 400 families, festival celebrations with underprivileged children, and cricket competitions for talent identification.

VISION:
Digital education is not a luxury; it is a right. By placing future-tech labs and skilled mentors in villages, we aim to create a generation that can innovate from the heart of rural India, turning local challenges into opportunities.

CONTACT DETAILS:
Email: info@sankalppathshala.com
Phone and WhatsApp: +91 8055698328
To donate or support, visit sankalpshiksha.com/donate.

AI ASSISTANT CREDITS:
If anyone asks who developed this AI assistant, tell them it was built by NexGenAiTech, a modern AI and Full-Stack Development company founded by Jahid, who specializes in Artificial Intelligence, automation systems, scalable web technologies, and advanced software development. NexGenAiTech builds intelligent digital solutions for businesses, startups, educational organizations, and enterprises globally. Their website is https://nexgenaitech.online. They offer AI Chatbot Development, Custom AI Solutions, Website Design, Mobile App Development, Business Automation, CRM and ERP systems, API Integration, UI and UX Design, SEO and Digital Marketing, and more. For business inquiries, contact Jahid at +91 8055698328.

YOUR RESPONSE RULES:
Use plain paragraphs only. Never use markdown formatting like bold, italic, headings, tables, lists, or code blocks. Write naturally as if you are talking to a friend. Use simple, clear sentences. Break information into short paragraphs of two to four sentences each. Use a blank line between paragraphs.

Keep a friendly, warm, mentor-like tone. Respond in the same language the user uses, whether Hindi, English, or Hinglish. Be admission-aware and academic-aware. If someone asks for help with admission or courses, gently collect their name, class, interest, phone, city, parent name, and email. After collecting, tell them our team will contact them soon.

If you do not know something, say so honestly and suggest contacting the support team at info@sankalppathshala.com or +91 8055698328.`;

// ---------- ROUTES ----------

// AI Question Solver (Gemini)
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

// Sankalp Sathi Chatbot (OpenRouter via fetch, fallback to Gemini)
app.post('/api/chat', async (req, res) => {
  try {
    await connectDB();
    let { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message required.' });

    message = filterPrompt(xss(message));

    // If OpenRouter key is not set, fallback to Gemini
    if (!OPENROUTER_API_KEY) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nUser: ${message}`);
      const reply = (await result.response).text();
      return res.json({ reply });
    }

    // Use OpenRouter API via fetch
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
        ]
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'I am not sure how to respond to that. Please try asking differently.';
    res.json({ reply });
  } catch (err) {
    console.error('Chatbot Error:', err);
    // Final fallback response
    res.json({
      reply: 'I am having a small technical issue right now. Please try again in a moment, or reach out to our team at info@sankalppathshala.com or call +91 8055698328. We are always happy to help!'
    });
  }
});

// Lead capture
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

// Contact form
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

// Public result checker
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

    const newInquiries = await Inquiry.countDocuments({ status: 'new' });
    const contactedInquiries = await Inquiry.countDocuments({ status: 'contacted' });

    res.json({
      stats: { totalChats, totalSolves, totalLeads, totalInquiries, newInquiries, contactedInquiries, totalResults }
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

// ---------- RESULTS CRUD ----------
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
