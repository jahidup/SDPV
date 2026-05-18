/* ======================== app.js – SINGLE FRONTEND JS FILE ======================== */
document.addEventListener('DOMContentLoaded', function () {
  // ---------- UTILS ----------
  const API_BASE = '';

  function showToast(msg, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.textContent = msg;
    Object.assign(toast.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      background: isError ? '#ef4444' : '#10b981', color: 'white', padding: '0.8rem 2rem',
      borderRadius: '50px', zIndex: 9999, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function sanitize(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---------- MOBILE NAV ----------
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => navLinks.classList.toggle('active'));
  }

  // Active link highlighting
  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-links a').forEach(a => {
    if (a.getAttribute('href') === currentPath || (currentPath === '/' && a.getAttribute('href') === '/')) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });

  // ---------- HOME PAGE DYNAMIC CONTENT ----------
  const homeCourses = document.getElementById('homeCourses');
  if (homeCourses) {
    fetch('/api/public/programs')
      .then(res => res.json())
      .then(programs => {
        if (programs.length) {
          homeCourses.innerHTML = programs.slice(0, 4).map(p => `
            <div class="course-card">
              <div class="course-img" style="background: var(--primary-light); height:160px; display:flex; align-items:center; justify-content:center; font-size:3rem;">📘</div>
              <div class="course-content">
                <span class="course-tag">${p.category}</span>
                <h3>${p.title}</h3>
                <p>${p.description.substring(0, 100)}...</p>
                <a href="/courses" class="btn-primary">Learn More</a>
              </div>
            </div>
          `).join('');
        }
      })
      .catch(() => {});
  }

  const homeGallery = document.getElementById('homeGallery');
  if (homeGallery) {
    fetch('/api/public/gallery')
      .then(res => res.json())
      .then(items => {
        if (items.length) {
          homeGallery.innerHTML = items.slice(0, 4).map(item => `
            <div class="gallery-item glass-light">
              <img src="${item.imageUrl}" alt="${item.caption || 'Campus'}" loading="lazy">
            </div>
          `).join('');
        }
      })
      .catch(() => {});
  }

  const homeEvents = document.getElementById('homeEvents');
  if (homeEvents) {
    fetch('/api/public/events')
      .then(res => res.json())
      .then(events => {
        if (events.length) {
          homeEvents.innerHTML = events.slice(0, 3).map(e => `
            <div class="event-card glass-light" style="padding:1.5rem;">
              <h3>${e.title}</h3>
              <p><strong>${formatDate(e.date)}</strong></p>
              <p>${e.description.substring(0, 80)}...</p>
            </div>
          `).join('');
        }
      })
      .catch(() => {});
  }

  // Counter animation for stat numbers
  const statNumbers = document.querySelectorAll('.stat-number[data-count]');
  if (statNumbers.length) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const count = parseInt(el.getAttribute('data-count'));
          let current = 0;
          const increment = Math.ceil(count / 50);
          const timer = setInterval(() => {
            current += increment;
            if (current >= count) {
              el.textContent = count + '+';
              clearInterval(timer);
            } else {
              el.textContent = current + '+';
            }
          }, 30);
          observer.unobserve(el);
        }
      });
    });
    statNumbers.forEach(el => observer.observe(el));
  }

  // Testimonials slider (simple)
  const testimonialCards = document.querySelectorAll('#testimonialCarousel .testimonial-card');
  if (testimonialCards.length > 1) {
    let currentTestimonial = 0;
    const show = (index) => {
      testimonialCards.forEach((c, i) => c.style.display = i === index ? 'block' : 'none');
    };
    show(0);
    setInterval(() => {
      currentTestimonial = (currentTestimonial + 1) % testimonialCards.length;
      show(currentTestimonial);
    }, 4000);
  }

  // ---------- FAQ ACCORDION (Any page) ----------
  document.querySelectorAll('.faq-item .faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.closest('.faq-item');
      const isActive = item.classList.contains('active');
      // Close all siblings
      const parent = item.parentElement;
      parent.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
      if (!isActive) item.classList.add('active');
    });
  });

  // ---------- CONTACT FORM (contact.html) ----------
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        fullName: document.getElementById('fullName').value.trim(),
        email: document.getElementById('email').value.trim(),
        mobile: document.getElementById('mobile').value.trim(),
        subject: document.getElementById('subject').value,
        message: document.getElementById('message').value.trim()
      };
      const feedback = document.getElementById('contactFeedback');
      feedback.style.display = 'block';
      feedback.textContent = 'Sending...';
      feedback.style.color = 'var(--slate)';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        if (result.success) {
          feedback.textContent = 'Thank you! We will get back to you soon.';
          feedback.style.color = '#10b981';
          contactForm.reset();
        } else {
          feedback.textContent = 'Error: ' + (result.error || 'Something went wrong');
          feedback.style.color = '#ef4444';
        }
      } catch (err) {
        feedback.textContent = 'Network error. Please try again.';
        feedback.style.color = '#ef4444';
      }
    });
  }

  // ---------- NEWSLETTER SIGNUP ----------
  const newsletterForm = document.getElementById('newsletterForm');
  if (newsletterForm) {
    newsletterForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = newsletterForm.querySelector('input[type="email"]').value;
      // Could send to an API, for now just toast
      showToast('Subscribed successfully!');
      newsletterForm.reset();
    });
  }

  // ---------- AI SOLVER PAGE (ai-learning.html) ----------
  const solverTabs = document.querySelectorAll('.tab-btn');
  const inputText = document.getElementById('input-text');
  const inputImage = document.getElementById('input-image');
  const inputPdf = document.getElementById('input-pdf');
  if (solverTabs.length) {
    solverTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        solverTabs.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        inputText.classList.add('hidden');
        inputImage.classList.add('hidden');
        inputPdf.classList.add('hidden');
        if (tab === 'text') inputText.classList.remove('hidden');
        else if (tab === 'image') inputImage.classList.remove('hidden');
        else if (tab === 'pdf') inputPdf.classList.remove('hidden');
      });
    });
  }

  // Image upload handling
  const imageFileInput = document.getElementById('imageFileInput');
  const pickImageBtn = document.getElementById('pickImageBtn');
  const imagePreview = document.getElementById('imagePreview');
  const imagePreviewImg = document.getElementById('imagePreviewImg');
  const removeImageBtn = document.getElementById('removeImageBtn');
  if (pickImageBtn) {
    pickImageBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          imagePreviewImg.src = ev.target.result;
          imagePreview.style.display = 'block';
        };
        reader.readAsDataURL(e.target.files[0]);
      }
    });
    removeImageBtn?.addEventListener('click', () => {
      imageFileInput.value = '';
      imagePreview.style.display = 'none';
    });
  }

  // PDF handling
  const pdfFileInput = document.getElementById('pdfFileInput');
  const pickPdfBtn = document.getElementById('pickPdfBtn');
  const pdfPreview = document.getElementById('pdfPreview');
  const pdfFileName = document.getElementById('pdfFileName');
  const removePdfBtn = document.getElementById('removePdfBtn');
  if (pickPdfBtn) {
    pickPdfBtn.addEventListener('click', () => pdfFileInput.click());
    pdfFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) {
        pdfFileName.textContent = e.target.files[0].name;
        pdfPreview.style.display = 'block';
      }
    });
    removePdfBtn?.addEventListener('click', () => {
      pdfFileInput.value = '';
      pdfPreview.style.display = 'none';
    });
  }

  // AI Solver submission
  const submitText = document.getElementById('submitText');
  const submitImage = document.getElementById('submitImage');
  const submitPdf = document.getElementById('submitPdf');
  const loadingIndicator = document.getElementById('loadingIndicator');
  const answerBox = document.getElementById('answerBox');
  const answerContent = document.getElementById('answerContent');

  async function solveQuestion(type) {
    let formData = new FormData();
    formData.append('type', type);
    if (type === 'text') {
      const text = document.getElementById('questionText')?.value.trim();
      if (!text) return alert('Please enter a question.');
      formData.append('question', text);
    } else if (type === 'image') {
      if (!imageFileInput.files[0]) return alert('Please select an image.');
      formData.append('file', imageFileInput.files[0]);
    } else if (type === 'pdf') {
      if (!pdfFileInput.files[0]) return alert('Please select a PDF.');
      formData.append('file', pdfFileInput.files[0]);
    }
    loadingIndicator?.classList.remove('hidden');
    answerBox.style.display = 'none';
    try {
      const res = await fetch('/api/solve-question', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        answerContent.innerHTML = data.answer.replace(/\n/g, '<br>');
        answerBox.style.display = 'block';
      } else {
        answerContent.textContent = data.error || 'An error occurred.';
        answerBox.style.display = 'block';
      }
    } catch (err) {
      answerContent.textContent = 'Network error. Please try again.';
      answerBox.style.display = 'block';
    } finally {
      loadingIndicator?.classList.add('hidden');
    }
  }

  submitText?.addEventListener('click', () => solveQuestion('text'));
  submitImage?.addEventListener('click', () => solveQuestion('image'));
  submitPdf?.addEventListener('click', () => solveQuestion('pdf'));

  // Quick example chips
  document.querySelectorAll('.example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.getElementById('questionText').value = chip.textContent;
      document.querySelector('.tab-btn[data-tab="text"]')?.click();
    });
  });

  // ---------- SANKALP SATHI CHATBOT ----------
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendMessageBtn');
  const typingIndicator = document.getElementById('typingIndicator');
  if (chatMessages && chatInput && sendBtn) {
    function addMessage(text, sender) {
      const div = document.createElement('div');
      div.className = `message ${sender}`;
      div.innerHTML = `<div class="bubble"><p>${sanitize(text)}</p></div>`;
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showTyping() { typingIndicator.classList.remove('hidden'); }
    function hideTyping() { typingIndicator.classList.add('hidden'); }

    async function sendMessage() {
      const msg = chatInput.value.trim();
      if (!msg) return;
      addMessage(msg, 'user');
      chatInput.value = '';
      showTyping();
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg })
        });
        const data = await res.json();
        hideTyping();
        addMessage(data.reply, 'bot');
        if (data.reply && (data.reply.includes('share your details') || data.reply.includes('contact you'))) {
          setTimeout(() => {
            document.getElementById('leadCaptureCard')?.classList.remove('hidden');
          }, 2000);
        }
      } catch (err) {
        hideTyping();
        addMessage('Sorry, I faced a glitch. Please try again.', 'bot');
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(); });

    // Quick prompts
    document.querySelectorAll('.prompt-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chatInput.value = chip.textContent;
        sendMessage();
      });
    });

    // Lead capture form
    const leadForm = document.getElementById('leadCaptureForm');
    if (leadForm) {
      leadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
          firstName: document.getElementById('leadFirstName').value,
          class: document.getElementById('leadClass').value,
          interest: document.getElementById('leadInterest').value,
          phone: document.getElementById('leadPhone').value,
          city: document.getElementById('leadCity').value,
          parentName: document.getElementById('leadParentName').value,
          email: document.getElementById('leadEmail').value
        };
        try {
          const res = await fetch('/api/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
          const result = await res.json();
          if (result.success) {
            document.getElementById('leadFeedback').textContent = 'Thank you! Our team will reach out soon.';
            document.getElementById('leadFeedback').classList.remove('hidden');
            leadForm.reset();
          } else {
            alert('Submission failed: ' + (result.error || 'Unknown error'));
          }
        } catch (err) { alert('Network error.'); }
      });
    }
  }

  // ---------- PUBLIC RESULT CHECKER (results.html) ----------
  const resultForm = document.getElementById('resultCheckForm');
  if (resultForm) {
    resultForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const regNumber = document.getElementById('regNumber').value.trim();
      const dob = document.getElementById('dob').value;
      const errorDiv = document.getElementById('formError');
      errorDiv.classList.add('hidden');
      try {
        const res = await fetch('/api/result/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ registrationNumber: regNumber, dob })
        });
        const data = await res.json();
        if (data.success && data.result) {
          displayMarksheet(data.result);
        } else {
          errorDiv.textContent = data.error || 'No result found.';
          errorDiv.classList.remove('hidden');
          document.getElementById('marksheetSection').style.display = 'none';
        }
      } catch (err) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.classList.remove('hidden');
      }
    });
  }

  function displayMarksheet(result) {
    document.getElementById('ms-studentName').textContent = result.studentName;
    document.getElementById('ms-fatherName').textContent = result.fatherName;
    document.getElementById('ms-regNumber').textContent = result.registrationNumber;
    document.getElementById('ms-dob').textContent = new Date(result.dob).toLocaleDateString('en-IN');
    document.getElementById('ms-class').textContent = result.class;
    document.getElementById('ms-session').textContent = result.session;
    document.getElementById('ms-issueDate').textContent = formatDate(result.issueDate);
    const subjectsTbody = document.getElementById('ms-subjects');
    subjectsTbody.innerHTML = result.subjects.map(s => `<tr><td>${s.subject}</td><td>${s.marksObtained}</td><td>${s.maxMarks}</td></tr>`).join('');
    document.getElementById('ms-percentage').textContent = result.percentage + '%';
    document.getElementById('ms-grade').textContent = result.grade;
    document.getElementById('ms-remarks').textContent = result.remarks || '—';
    document.getElementById('marksheetSection').style.display = 'block';
    document.getElementById('downloadPdfBtn').onclick = () => window.print();
    document.getElementById('printResultBtn').onclick = () => window.print();
  }

  // ---------- ADMIN LOGIN ----------
  const adminLoginForm = document.getElementById('adminLoginForm');
  if (adminLoginForm) {
    adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('adminEmail').value;
      const password = document.getElementById('adminPassword').value;
      const errorEl = document.getElementById('loginError');
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/admin-dashboard';
        } else {
          errorEl.textContent = data.error || 'Login failed';
          errorEl.style.display = 'block';
        }
      } catch (err) {
        errorEl.textContent = 'Network error';
        errorEl.style.display = 'block';
      }
    });
  }

  // ---------- ADMIN DASHBOARD ----------
  const dashboardMain = document.getElementById('dashboardMain');
  if (dashboardMain) {
    fetch('/api/admin/check-auth')
      .then(res => res.json())
      .then(data => {
        if (!data.authenticated) {
          window.location.href = '/admin-login';
          return;
        }
        initDashboard();
      })
      .catch(() => window.location.href = '/admin-login');

    function initDashboard() {
      const sidebarLinks = document.querySelectorAll('#sidebarMenu a[data-tab]');
      const allTabs = document.querySelectorAll('.dashboard-tab');
      sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const tabId = link.dataset.tab;
          allTabs.forEach(tab => tab.classList.remove('active'));
          document.getElementById(tabId).classList.add('active');
          sidebarLinks.forEach(l => l.classList.remove('active'));
          link.classList.add('active');
          if (tabId === 'dashboardTab') loadDashboardStats();
          else if (tabId === 'leadsTab') loadLeads();
          else if (tabId === 'inquiriesTab') loadInquiries();
          else if (tabId === 'resultsTab') loadResults();
          else if (tabId === 'galleryTab') loadGalleryAdmin();
          else if (tabId === 'eventsTab') loadEventsAdmin();
          else if (tabId === 'programsTab') loadProgramsAdmin();
        });
      });

      document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/admin/logout', { method: 'POST' });
        window.location.href = '/admin-login';
      });

      loadDashboardStats();
    }

    async function loadDashboardStats() {
      try {
        const res = await fetch('/api/admin/dashboard');
        const data = await res.json();
        document.getElementById('dashboardStats').innerHTML = `
          <div class="stat-card"><h3>AI Chats</h3><div class="stat-value">${data.stats.totalChats}</div></div>
          <div class="stat-card"><h3>AI Solves</h3><div class="stat-value">${data.stats.totalSolves}</div></div>
          <div class="stat-card"><h3>Leads</h3><div class="stat-value">${data.stats.totalLeads}</div></div>
          <div class="stat-card"><h3>Inquiries</h3><div class="stat-value">${data.stats.totalInquiries}</div></div>
          <div class="stat-card"><h3>Results</h3><div class="stat-value">${data.stats.totalResults}</div></div>
        `;
      } catch (err) { console.error(err); }
    }

    // Inquiries
    async function loadInquiries() {
      const tbody = document.querySelector('#inquiriesTable tbody');
      const filter = document.getElementById('inquiryStatusFilter').value;
      const res = await fetch('/api/admin/inquiries');
      let inquiries = await res.json();
      if (filter !== 'all') inquiries = inquiries.filter(i => i.status === filter);
      tbody.innerHTML = inquiries.map(i => `
        <tr>
          <td>${i.fullName}</td><td>${i.email}</td><td>${i.subject}</td>
          <td>${i.status}</td><td>${formatDate(i.createdAt)}</td>
          <td>
            <select class="status-select" data-id="${i._id}">
              <option ${i.status==='new'?'selected':''}>new</option>
              <option ${i.status==='contacted'?'selected':''}>contacted</option>
              <option ${i.status==='closed'?'selected':''}>closed</option>
            </select>
            <button class="btn-small danger delete-inquiry" data-id="${i._id}">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', async () => {
          await fetch(`/api/admin/inquiries/${select.dataset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value })
          });
          loadInquiries();
        });
      });
      document.querySelectorAll('.delete-inquiry').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete?')) {
            await fetch(`/api/admin/inquiries/${btn.dataset.id}`, { method: 'DELETE' });
            loadInquiries();
          }
        });
      });
    }
    document.getElementById('inquiryStatusFilter')?.addEventListener('change', loadInquiries);

    // Leads
    async function loadLeads() {
      const tbody = document.querySelector('#leadsTable tbody');
      const filter = document.getElementById('leadStatusFilter').value;
      const res = await fetch('/api/admin/leads');
      if (!res.ok) { tbody.innerHTML = '<tr><td colspan="7">No lead data available</td></tr>'; return; }
      let leads = await res.json();
      if (filter !== 'all') leads = leads.filter(l => l.status === filter);
      tbody.innerHTML = leads.map(l => `
        <tr>
          <td>${l.firstName}</td><td>${l.class}</td><td>${l.interest}</td>
          <td>${l.phone}</td><td>${l.leadScore}</td><td>${l.status}</td>
          <td>
            <select class="lead-status-select" data-id="${l._id}">
              <option ${l.status==='pending'?'selected':''}>pending</option>
              <option ${l.status==='contacted'?'selected':''}>contacted</option>
              <option ${l.status==='converted'?'selected':''}>converted</option>
            </select>
            <button class="btn-small danger delete-lead" data-id="${l._id}">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.querySelectorAll('.lead-status-select').forEach(select => {
        select.addEventListener('change', async () => {
          await fetch(`/api/admin/leads/${select.dataset.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value })
          });
          loadLeads();
        });
      });
      document.querySelectorAll('.delete-lead').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete?')) {
            await fetch(`/api/admin/leads/${btn.dataset.id}`, { method: 'DELETE' });
            loadLeads();
          }
        });
      });
    }
    document.getElementById('leadStatusFilter')?.addEventListener('change', loadLeads);

    // Results CRUD
    async function loadResults() {
      const tbody = document.querySelector('#resultsTable tbody');
      const res = await fetch('/api/admin/results');
      const results = await res.json();
      tbody.innerHTML = results.map(r => `
        <tr>
          <td>${r.registrationNumber}</td><td>${r.studentName}</td><td>${r.class}</td>
          <td>${r.percentage}%</td><td>${r.published ? '✅' : '❌'}</td>
          <td>
            <button class="btn-small edit-result" data-id="${r._id}">✏️</button>
            <button class="btn-small danger delete-result" data-id="${r._id}">🗑️</button>
          </td>
        </tr>
      `).join('');
      document.querySelectorAll('.edit-result').forEach(btn => btn.addEventListener('click', () => editResult(btn.dataset.id)));
      document.querySelectorAll('.delete-result').forEach(btn => btn.addEventListener('click', () => {
        if (confirm('Delete?')) {
          fetch(`/api/admin/results/${btn.dataset.id}`, { method: 'DELETE' }).then(loadResults);
        }
      }));
    }
    document.getElementById('addResultBtn')?.addEventListener('click', () => {
      document.getElementById('resultModalTitle').textContent = 'Add Result';
      document.getElementById('resultId').value = '';
      document.getElementById('resultForm').reset();
      document.getElementById('resultModalOverlay').classList.add('active');
    });
    document.getElementById('resultForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('resultId').value;
      const data = {
        registrationNumber: document.getElementById('resRegNo').value,
        studentName: document.getElementById('resStudentName').value,
        fatherName: document.getElementById('resFatherName').value,
        dob: document.getElementById('resDob').value,
        class: document.getElementById('resClass').value,
        session: document.getElementById('resSession').value,
        subjects: JSON.parse(document.getElementById('resSubjects').value),
        percentage: parseFloat(document.getElementById('resPercentage').value),
        grade: document.getElementById('resGrade').value,
        remarks: document.getElementById('resRemarks').value,
        published: document.getElementById('resPublished').checked,
        issueDate: document.getElementById('resIssueDate').value || new Date().toISOString().split('T')[0]
      };
      const method = id ? 'PUT' : 'POST';
      const url = id ? `/api/admin/results/${id}` : '/api/admin/results';
      await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      document.getElementById('resultModalOverlay').classList.remove('active');
      loadResults();
    });
    document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-overlay').forEach(o => o.classList.remove('active'));
    }));
    async function editResult(id) {
      const res = await fetch('/api/admin/results');
      const results = await res.json();
      const r = results.find(r => r._id === id);
      if (!r) return;
      document.getElementById('resultModalTitle').textContent = 'Edit Result';
      document.getElementById('resultId').value = r._id;
      document.getElementById('resRegNo').value = r.registrationNumber;
      document.getElementById('resStudentName').value = r.studentName;
      document.getElementById('resFatherName').value = r.fatherName;
      document.getElementById('resDob').value = new Date(r.dob).toISOString().split('T')[0];
      document.getElementById('resClass').value = r.class;
      document.getElementById('resSession').value = r.session;
      document.getElementById('resSubjects').value = JSON.stringify(r.subjects);
      document.getElementById('resPercentage').value = r.percentage;
      document.getElementById('resGrade').value = r.grade;
      document.getElementById('resRemarks').value = r.remarks || '';
      document.getElementById('resPublished').checked = r.published;
      document.getElementById('resIssueDate').value = new Date(r.issueDate).toISOString().split('T')[0];
      document.getElementById('resultModalOverlay').classList.add('active');
    }

    // Gallery Admin
    document.getElementById('galleryUploadForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const file = document.getElementById('galleryImageInput').files[0];
      const caption = document.getElementById('galleryCaption').value;
      const formData = new FormData();
      formData.append('image', file);
      formData.append('caption', caption);
      await fetch('/api/admin/gallery', { method: 'POST', body: formData });
      loadGalleryAdmin();
    });
    async function loadGalleryAdmin() {
      const grid = document.getElementById('adminGalleryGrid');
      const res = await fetch('/api/admin/gallery');
      const items = await res.json();
      grid.innerHTML = items.map(item => `
        <div class="gallery-item glass-light">
          <img src="${item.imageUrl}" alt="${item.caption}">
          <button class="btn-small danger delete-gallery" data-id="${item._id}">🗑️</button>
        </div>
      `).join('');
      document.querySelectorAll('.delete-gallery').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete?')) {
            await fetch(`/api/admin/gallery/${btn.dataset.id}`, { method: 'DELETE' });
            loadGalleryAdmin();
          }
        });
      });
    }

    // Events Admin
    document.getElementById('addEventBtn')?.addEventListener('click', () => {
      document.getElementById('eventModalTitle').textContent = 'Add Event';
      document.getElementById('eventId').value = '';
      document.getElementById('eventForm').reset();
      document.getElementById('eventModalOverlay').classList.add('active');
    });
    document.getElementById('eventForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('eventId').value;
      const formData = new FormData();
      formData.append('title', document.getElementById('evTitle').value);
      formData.append('description', document.getElementById('evDesc').value);
      formData.append('date', document.getElementById('evDate').value);
      const imgFile = document.getElementById('evImage').files[0];
      if (imgFile) formData.append('image', imgFile);
      const url = id ? `/api/admin/events/${id}` : '/api/admin/events';
      await fetch(url, { method: id ? 'PUT' : 'POST', body: formData });
      document.getElementById('eventModalOverlay').classList.remove('active');
      loadEventsAdmin();
    });
    async function loadEventsAdmin() {
      const list = document.getElementById('eventsList');
      const res = await fetch('/api/admin/events');
      const events = await res.json();
      list.innerHTML = events.map(e => `
        <div class="glass-light" style="padding:1rem; margin-bottom:0.5rem; display:flex; justify-content:space-between;">
          <div><strong>${e.title}</strong> - ${formatDate(e.date)}</div>
          <div>
            <button class="btn-small edit-event" data-id="${e._id}">✏️</button>
            <button class="btn-small danger delete-event" data-id="${e._id}">🗑️</button>
          </div>
        </div>
      `).join('');
      document.querySelectorAll('.edit-event').forEach(btn => btn.addEventListener('click', async () => {
        const res = await fetch('/api/admin/events');
        const events = await res.json();
        const ev = events.find(e => e._id === btn.dataset.id);
        document.getElementById('eventModalTitle').textContent = 'Edit Event';
        document.getElementById('eventId').value = ev._id;
        document.getElementById('evTitle').value = ev.title;
        document.getElementById('evDesc').value = ev.description;
        document.getElementById('evDate').value = new Date(ev.date).toISOString().split('T')[0];
        document.getElementById('eventModalOverlay').classList.add('active');
      }));
      document.querySelectorAll('.delete-event').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete?')) {
            await fetch(`/api/admin/events/${btn.dataset.id}`, { method: 'DELETE' });
            loadEventsAdmin();
          }
        });
      });
    }

    // Programs Admin
    document.getElementById('addProgramBtn')?.addEventListener('click', () => {
      document.getElementById('programModalTitle').textContent = 'Add Program';
      document.getElementById('programId').value = '';
      document.getElementById('programForm').reset();
      document.getElementById('programModalOverlay').classList.add('active');
    });
    document.getElementById('programForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('programId').value;
      const data = {
        title: document.getElementById('progTitle').value,
        category: document.getElementById('progCategory').value,
        description: document.getElementById('progDesc').value,
        features: document.getElementById('progFeatures').value.split(',').map(s => s.trim()).filter(Boolean),
        image: document.getElementById('progImage').value
      };
      const url = id ? `/api/admin/programs/${id}` : '/api/admin/programs';
      await fetch(url, { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      document.getElementById('programModalOverlay').classList.remove('active');
      loadProgramsAdmin();
    });
    async function loadProgramsAdmin() {
      const list = document.getElementById('programsList');
      const res = await fetch('/api/admin/programs');
      const programs = await res.json();
      list.innerHTML = programs.map(p => `
        <div class="glass-light" style="padding:1rem; margin-bottom:0.5rem; display:flex; justify-content:space-between;">
          <div><strong>${p.title}</strong> (${p.category})</div>
          <div>
            <button class="btn-small edit-program" data-id="${p._id}">✏️</button>
            <button class="btn-small danger delete-program" data-id="${p._id}">🗑️</button>
          </div>
        </div>
      `).join('');
      document.querySelectorAll('.edit-program').forEach(btn => btn.addEventListener('click', async () => {
        const res = await fetch('/api/admin/programs');
        const programs = await res.json();
        const pr = programs.find(p => p._id === btn.dataset.id);
        document.getElementById('programModalTitle').textContent = 'Edit Program';
        document.getElementById('programId').value = pr._id;
        document.getElementById('progTitle').value = pr.title;
        document.getElementById('progCategory').value = pr.category;
        document.getElementById('progDesc').value = pr.description;
        document.getElementById('progFeatures').value = pr.features.join(', ');
        document.getElementById('progImage').value = pr.image || '';
        document.getElementById('programModalOverlay').classList.add('active');
      }));
      document.querySelectorAll('.delete-program').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Delete?')) {
            await fetch(`/api/admin/programs/${btn.dataset.id}`, { method: 'DELETE' });
            loadProgramsAdmin();
          }
        });
      });
    }
  }

  // ---------- PUBLIC GALLERY LIGHTBOX ----------
  const galleryGrid = document.getElementById('galleryGrid');
  if (galleryGrid && !document.getElementById('dashboardMain')) {
    fetch('/api/public/gallery')
      .then(res => res.json())
      .then(items => {
        if (items.length) {
          galleryGrid.innerHTML = items.map(item => `
            <div class="gallery-item glass-light" data-img="${item.imageUrl}" data-caption="${item.caption || ''}">
              <img src="${item.imageUrl}" alt="${item.caption || ''}" loading="lazy">
            </div>
          `).join('');
          document.querySelectorAll('#galleryGrid .gallery-item').forEach(item => {
            item.addEventListener('click', () => {
              document.getElementById('lightboxImage').src = item.dataset.img;
              document.getElementById('lightboxCaption').textContent = item.dataset.caption;
              document.getElementById('lightbox').style.display = 'flex';
            });
          });
        } else {
          document.getElementById('galleryEmpty')?.classList.remove('hidden');
        }
      });
    document.getElementById('lightboxClose')?.addEventListener('click', () => {
      document.getElementById('lightbox').style.display = 'none';
    });
    document.getElementById('lightboxOverlay')?.addEventListener('click', () => {
      document.getElementById('lightbox').style.display = 'none';
    });
  }

  // ---------- PUBLIC EVENTS ----------
  const eventsGrid = document.getElementById('eventsGrid');
  if (eventsGrid && !document.getElementById('dashboardMain')) {
    fetch('/api/public/events')
      .then(res => res.json())
      .then(events => {
        if (events.length) {
          const upcoming = events.filter(e => new Date(e.date) >= new Date());
          const past = events.filter(e => new Date(e.date) < new Date());
          eventsGrid.innerHTML = upcoming.map(e => `
            <div class="event-card glass-light" style="padding:1.5rem;">
              <h3>${e.title}</h3>
              <p><strong>${formatDate(e.date)}</strong></p>
              <p>${e.description}</p>
            </div>
          `).join('');
          const highlightsGrid = document.getElementById('highlightsGrid');
          if (highlightsGrid) {
            highlightsGrid.innerHTML = past.map(e => `
              <div class="event-card glass-light" style="padding:1.5rem;">
                <h3>${e.title}</h3>
                <p>${formatDate(e.date)}</p>
                <p>${e.description.substring(0,100)}...</p>
              </div>
            `).join('');
          }
        } else {
          document.getElementById('eventsEmpty')?.classList.remove('hidden');
        }
      });
  }

});
