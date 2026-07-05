/**
 * SK FEDERATION - TRANSPARENT GOVERNANCE
 * Main Application Script
 */

// ==========================================
// DATA
// Was hardcoded before — now fetched from API
// ==========================================

let DOCUMENTS_DATA = [];


// ==========================================
// AUTH STATE
// ==========================================

let currentUser = null;
let commentMode = null;
let activeDocId = null;

const MOCK_USERS = [
    { email: 'maria@example.com', password: 'password123', firstName: 'Maria', lastName: 'Reyes', barangay: 'san-roque' }
];


// ==========================================
// MODAL CONTROLLER
// ==========================================

class ModalController {

    static open(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }

    static close(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.style.display = 'none';
            const anyOpen = document.querySelector('.sk-modal-overlay[style*="flex"]');
            if (!anyOpen) document.body.style.overflow = '';
        }
    }

    static closeAll() {
        document.querySelectorAll('.sk-modal-overlay').forEach(m => m.style.display = 'none');
        document.body.style.overflow = '';
    }

    static init() {
        document.querySelectorAll('[data-close]').forEach(btn => {
            btn.addEventListener('click', () => {
                ModalController.close(btn.getAttribute('data-close'));
            });
        });

        document.querySelectorAll('.sk-modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) ModalController.close(overlay.id);
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') ModalController.closeAll();
        });
    }
}


// ==========================================
// AUTH CONTROLLER
// ==========================================

class AuthController {

    static init() {
        document.getElementById('headerLoginBtn')?.addEventListener('click', () => {
            ModalController.open('loginModal');
        });

        document.getElementById('headerRegisterBtn')?.addEventListener('click', () => {
            AuthController.loadBarangays();
            ModalController.open('registerModal');
        });

        document.getElementById('signOutBtn')?.addEventListener('click', () => {
            AuthController.signOut();
        });

        document.getElementById('goToRegisterBtn')?.addEventListener('click', () => {
            ModalController.close('loginModal');
            AuthController.loadBarangays();
            ModalController.open('registerModal');
        });

        document.getElementById('goToLoginBtn')?.addEventListener('click', () => {
            ModalController.close('registerModal');
            ModalController.open('loginModal');
        });

        document.getElementById('loginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            AuthController.handleLogin();
        });

        document.getElementById('registerForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            AuthController.handleRegister();
        });

        document.querySelectorAll('.sk-pw-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const input = document.getElementById(targetId);
                if (!input) return;
                const isText = input.type === 'text';
                input.type = isText ? 'password' : 'text';
                btn.querySelector('i').className = isText ? 'fas fa-eye' : 'fas fa-eye-slash';
            });
        });

        document.getElementById('regPassword')?.addEventListener('input', (e) => {
            AuthController.updatePasswordStrength(e.target.value);
        });
    }

    static async handleLogin() {
        const email    = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        AuthController.clearErrors(['loginEmail', 'loginPassword']);
        let valid = true;

        if (!email) {
            AuthController.showError('loginEmailError', 'Email is required.');
            valid = false;
        } else if (!AuthController.isValidEmail(email)) {
            AuthController.showError('loginEmailError', 'Please enter a valid email address.');
            document.getElementById('loginEmail').classList.add('is-invalid');
            valid = false;
        }

        if (!password) {
            AuthController.showError('loginPasswordError', 'Password is required.');
            valid = false;
        }

        if (!valid) return;

        // Disable button while processing
        const submitBtn = document.querySelector('#loginForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Signing in...'; }

        try {
            const response = await fetch('api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            const result = await response.json();

            if (!result.success) {
                AuthController.showError('loginPasswordError', result.message);
                document.getElementById('loginPassword').classList.add('is-invalid');
                return;
            }

            // Success
            const user = result.user;
            AuthController.setUser({
                userId:    user.userId,
                firstName: user.firstName,
                lastName:  user.lastName,
                email:     user.email,
            });

            if (activeDocId !== null) {
                ModalController.close('loginModal');
                CommentController.enterUserMode();
                ModalController.open('commentModal');
            } else {
                ModalController.close('loginModal');
            }

            AuthController.showToast(`Welcome back, ${user.firstName}!`);

        } catch (error) {
            console.error('Login error:', error);
            AuthController.showToast('Something went wrong. Please try again.');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i> Sign In'; }
        }
    }

    static async handleRegister() {
        const firstName     = document.getElementById('regFirstName').value.trim();
        const lastName      = document.getElementById('regLastName').value.trim();
        const middleInitial = document.getElementById('regMiddleInitial').value.trim();
        const email         = document.getElementById('regEmail').value.trim();
        const barangayId    = parseInt(document.getElementById('regBarangay').value) || 0;
        const password      = document.getElementById('regPassword').value;
        const confirmPassword = document.getElementById('regConfirmPassword').value;
        const consent       = document.getElementById('regConsent').checked;

        const fields = ['regFirstName', 'regLastName', 'regEmail', 'regBarangay', 'regPassword', 'regConfirmPassword', 'regConsent'];
        AuthController.clearErrors(fields);

        let valid = true;

        if (!firstName) { AuthController.showError('regFirstNameError', 'First name is required.'); document.getElementById('regFirstName').classList.add('is-invalid'); valid = false; }
        if (!lastName)  { AuthController.showError('regLastNameError',  'Last name is required.');  document.getElementById('regLastName').classList.add('is-invalid');  valid = false; }
        if (!email) {
            AuthController.showError('regEmailError', 'Email is required.');
            document.getElementById('regEmail').classList.add('is-invalid');
            valid = false;
        } else if (!AuthController.isValidEmail(email)) {
            AuthController.showError('regEmailError', 'Please enter a valid email address.');
            document.getElementById('regEmail').classList.add('is-invalid');
            valid = false;
        }
        if (!barangayId) { AuthController.showError('regBarangayError', 'Please select your barangay.'); document.getElementById('regBarangay').classList.add('is-invalid'); valid = false; }
        if (!password) {
            AuthController.showError('regPasswordError', 'Password is required.');
            document.getElementById('regPassword').classList.add('is-invalid');
            valid = false;
        } else if (password.length < 8) {
            AuthController.showError('regPasswordError', 'Password must be at least 8 characters.');
            document.getElementById('regPassword').classList.add('is-invalid');
            valid = false;
        }
        if (!confirmPassword) {
            AuthController.showError('regConfirmError', 'Please confirm your password.');
            document.getElementById('regConfirmPassword').classList.add('is-invalid');
            valid = false;
        } else if (password !== confirmPassword) {
            AuthController.showError('regConfirmError', 'Passwords do not match.');
            document.getElementById('regConfirmPassword').classList.add('is-invalid');
            valid = false;
        }
        if (!consent) { AuthController.showError('regConsentError', 'You must agree to the Terms of Use to register.'); valid = false; }

        if (!valid) return;

        // Disable submit button while processing
        const submitBtn = document.querySelector('#registerForm button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i> Creating account...'; }

        try {
            const response = await fetch('api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    firstName,
                    lastName,
                    middleInitial,
                    email,
                    barangayId,
                    password,
                    confirmPassword
                })
            });

            const result = await response.json();

            if (!result.success) {
                // Show field-level errors if returned
                if (result.errors) {
                    Object.keys(result.errors).forEach(field => {
                        AuthController.showError(field + 'Error', result.errors[field]);
                        document.getElementById('reg' + field.charAt(0).toUpperCase() + field.slice(1))?.classList.add('is-invalid');
                    });
                } else {
                    AuthController.showToast(result.message || 'Registration failed. Please try again.');
                }
                return;
            }

            // Success — set user and close modal
            const user = result.user;
            AuthController.setUser({
                userId:     user.userId,
                firstName:  user.firstName,
                lastName:   user.lastName,
                email:      user.email,
            });

            if (activeDocId !== null) {
                ModalController.close('registerModal');
                CommentController.enterUserMode();
                ModalController.open('commentModal');
            } else {
                ModalController.close('registerModal');
            }

            AuthController.showToast(`Account created! Welcome, ${user.firstName}!`);

        } catch (error) {
            console.error('Register error:', error);
            AuthController.showToast('Something went wrong. Please try again.');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-user-plus me-2"></i> Create Account'; }
        }

        AuthController.showToast(`Account created! Welcome, ${firstName}!`);
    }

    static setUser(user) {
        currentUser = {
            userId:    user.userId,
            firstName: user.firstName,
            lastName:  user.lastName,
            email:     user.email,
        };
        const initials = (user.firstName[0] + user.lastName[0]).toUpperCase();
        document.getElementById('headerLoginBtn').style.display = 'none';
        document.getElementById('headerRegisterBtn').style.display = 'none';
        const pill = document.getElementById('userPill');
        pill.style.display = 'flex';
        pill.classList.remove('d-none');
        document.getElementById('userAvatar').textContent = initials;
        document.getElementById('userDisplayName').textContent = user.firstName;
    }

    static signOut() {
        currentUser = null;
        commentMode = null;
        document.getElementById('headerLoginBtn').style.display = '';
        document.getElementById('headerRegisterBtn').style.display = '';
        document.getElementById('userPill').style.display = 'none';
        AuthController.showToast('You have been signed out.');
    }

    static updatePasswordStrength(password) {
        const fill = document.getElementById('pwStrengthFill');
        const label = document.getElementById('pwStrengthLabel');
        if (!fill || !label) return;

        let score = 0;
        if (password.length >= 8)         score++;
        if (/[A-Z]/.test(password))       score++;
        if (/[0-9]/.test(password))       score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        const levels = [
            { pct: '0%',   color: '#ecf0f1', text: '',       textColor: '' },
            { pct: '25%',  color: '#e74c3c', text: 'Weak',   textColor: '#e74c3c' },
            { pct: '50%',  color: '#e67e22', text: 'Fair',   textColor: '#e67e22' },
            { pct: '75%',  color: '#f1c40f', text: 'Good',   textColor: '#c9900a' },
            { pct: '100%', color: '#27ae60', text: 'Strong', textColor: '#27ae60' }
        ];

        const level = levels[score];
        fill.style.width = level.pct;
        fill.style.background = level.color;
        label.textContent = level.text;
        label.style.color = level.textColor;
    }

    static async loadBarangays() {
        const select = document.getElementById('regBarangay');
        if (!select) return;

        // Don't reload if already populated
        if (select.options.length > 1) return;

        select.innerHTML = '<option value="" disabled selected>Loading barangays...</option>';

        try {
            const response = await fetch('api/get_barangays');
            const result   = await response.json();

            if (!result.success || !result.data.length) {
                select.innerHTML = '<option value="" disabled selected>No barangays found</option>';
                return;
            }

            // Populate dropdown with real barangay data
            select.innerHTML = '<option value="" disabled selected>Select your barangay</option>';
            result.data.forEach(b => {
                const option = document.createElement('option');
                option.value       = b.barangay_id;   // integer ID sent to register
                option.textContent = b.barangay_name;
                select.appendChild(option);
            });

        } catch (error) {
            console.error('Failed to load barangays:', error);
            select.innerHTML = '<option value="" disabled selected>Failed to load. Refresh and try again.</option>';
        }
    }

    static showError(elementId, message) {
        const el = document.getElementById(elementId);
        if (el) { el.textContent = message; el.classList.add('is-visible'); }
    }

    static clearErrors(fieldIds) {
        fieldIds.forEach(id => {
            const errorEl = document.getElementById(id + 'Error');
            if (errorEl) { errorEl.textContent = ''; errorEl.classList.remove('is-visible'); }
            const inputEl = document.getElementById(id);
            if (inputEl) inputEl.classList.remove('is-invalid', 'is-valid');
        });
    }

    static isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    static showToast(message) {
        const toast = document.getElementById('successToast');
        const msg = document.getElementById('toastMessage');
        if (!toast || !msg) return;
        msg.textContent = message;
        toast.classList.add('is-visible');
        setTimeout(() => toast.classList.remove('is-visible'), 3500);
    }
}


// ==========================================
// COMMENT CONTROLLER
// ==========================================

class CommentController {

    static openForDoc(docId) {
        activeDocId = docId;
        commentMode = null;

        // Find in the live DOCUMENTS_DATA fetched from API
        const doc = DOCUMENTS_DATA.find(d => d.id === docId);
        if (!doc) return;

        document.getElementById('commentDocCategory').textContent = doc.category;
        document.getElementById('commentDocTitle').textContent = doc.title;
        document.getElementById('commentDocMeta').textContent =
            `${doc.barangayName}  ·  Updated ${doc.date}`;

        CommentController.renderThread(doc);
        CommentController.resetComposeArea();

        // Anyone can open the thread to read it. Only the ability to
        // compose/submit a comment depends on being signed in.
        if (currentUser) {
            CommentController.enterUserMode();
        } else {
            CommentController.enterGuestViewMode();
        }
        ModalController.open('commentModal');
    }

    static resetComposeArea() {
        const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        hide('composeUserBanner');
        hide('composeCta');
        hide('composeBox');
        const textarea = document.getElementById('commentTextarea');
        if (textarea) textarea.value = '';
    }

    static enterUserMode() {
        if (!currentUser) return;
        commentMode = 'user';
        const initials = (currentUser.firstName[0] + currentUser.lastName[0]).toUpperCase();
        document.getElementById('composeAvatar').textContent = initials;
        document.getElementById('composeUserName').textContent = `${currentUser.firstName} ${currentUser.lastName}`;

        const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };
        const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        show('composeUserBanner');
        show('composeBox');
        hide('composeCta');
    }

    static enterGuestViewMode() {
        // Not signed in: they can still read the thread, but see a
        // "sign in to comment" prompt instead of an editable textarea.
        commentMode = null;
        const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'flex'; };
        const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
        hide('composeUserBanner');
        hide('composeBox');
        show('composeCta');
    }

    static renderThread(doc) {
        const thread = document.getElementById('commentThread');
        const countBadge = document.getElementById('commentCount');
        if (!thread) return;

        const comments = doc.comments || [];
        countBadge.textContent = comments.length;

        if (comments.length === 0) {
            thread.innerHTML = `
                <div class="sk-comment-empty">
                    <i class="fas fa-comment-dots"></i>
                    <p>No comments yet. Be the first to share your thoughts.</p>
                </div>`;
            return;
        }

        thread.innerHTML = comments.map((c, idx) => {
            // Support both old mock format and new API format
            const author   = c.author   || `${c.resident?.first_name || ''} ${c.resident?.last_name || ''}`.trim() || 'Anonymous';
            const initials = c.initials || (author !== 'Anonymous' ? (author[0] + (author.split(' ')[1]?.[0] || '')).toUpperCase() : null);
            const text     = c.text     || c.content || '';
            const time     = c.time     || new Date(c.created_at).toLocaleDateString();
            const isGuest  = c.isGuest  || false;
            const likes    = c.likes    || 0;
            const replies  = c.replies  || [];

            // Build SK reply bubbles, nested/indented under the resident's comment
            const repliesHtml = replies.map(r => {
                const skAuthor = `${r.replied_by?.first_name || ''} ${r.replied_by?.last_name || ''}`.trim() || 'SK Barangay';
                const skInitials = (skAuthor[0] + (skAuthor.split(' ')[1]?.[0] || '')).toUpperCase();
                const skTime = r.created_at ? new Date(r.created_at).toLocaleDateString() : '';

                return `
                <div class="sk-reply-item">
                    <div class="sk-comment-avatar sk-comment-avatar--official">
                        ${skInitials}
                    </div>
                    <div class="sk-comment-bubble sk-comment-bubble--official">
                        <div class="sk-comment-meta">
                            <span class="sk-comment-author">${skAuthor}</span>
                            <span class="sk-comment-badge">SK Barangay</span>
                            <span class="sk-comment-time">${skTime}</span>
                        </div>
                        <p class="sk-comment-text">${r.content || ''}</p>
                    </div>
                </div>`;
            }).join('');

            return `
            <div>
                <div class="sk-comment-item">
                    <div class="sk-comment-avatar ${isGuest ? 'sk-comment-avatar--ghost' : ''}">
                        ${isGuest ? '<i class="fas fa-user-secret"></i>' : (initials || '?')}
                    </div>
                    <div class="sk-comment-bubble">
                        <div class="sk-comment-meta">
                            <span class="sk-comment-author">${author}</span>
                            ${c.isOfficial ? '<span class="sk-comment-badge">Official</span>' : ''}
                            <span class="sk-comment-time">${time}</span>
                        </div>
                        <p class="sk-comment-text">${text}</p>
                        <div class="sk-comment-actions">
                            <button class="sk-comment-action-btn">
                                <i class="fas fa-thumbs-up"></i> ${likes}
                            </button>
                            <button class="sk-comment-action-btn">Reply</button>
                        </div>
                    </div>
                </div>
                ${repliesHtml ? `<div class="sk-reply-thread">${repliesHtml}</div>` : ''}
                ${idx < comments.length - 1 ? '<div class="sk-comment-divider"></div>' : ''}
            </div>`;
        }).join('');
    }

    static async submitComment() {
        const textarea = document.getElementById('commentTextarea');
        const text     = textarea?.value.trim();

        // Must be logged in
        if (!currentUser) {
            ModalController.close('commentModal');
            ModalController.open('loginModal');
            return;
        }

        if (!text) {
            textarea.style.border = '2px solid #e74c3c';
            setTimeout(() => textarea.style.border = '', 1500);
            return;
        }

        // Disable submit button while posting
        const submitBtn = document.getElementById('submitCommentBtn');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i> Posting...'; }

        try {
            const response = await fetch('api/post_comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    website_post_id: activeDocId,
                    resident_id:     currentUser.userId,
                    content:         text
                })
            });

            const result = await response.json();

            if (!result.success) {
                AuthController.showToast(result.message || 'Failed to post comment.');
                return;
            }

            // Clear textarea
            textarea.value = '';

            // Refresh the comment thread from API
            await CommentController.refreshThread(activeDocId);

            AuthController.showToast('Comment posted successfully!');

        } catch (error) {
            console.error('Comment error:', error);
            AuthController.showToast('Something went wrong. Please try again.');
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '<i class="fas fa-paper-plane me-1"></i> Submit'; }
        }
    }

    static async refreshThread(docId) {
        try {
            const response = await fetch(`api/get_posts?id=${docId}`);
            const result   = await response.json();

            if (!result.success || !result.data.length) return;

            const post = result.data[0];

            // Update local DOCUMENTS_DATA comments
            const doc = DOCUMENTS_DATA.find(d => d.id === docId);
            if (doc) doc.comments = post.comments || [];

            // Re-render the thread
            CommentController.renderThread(doc);

            // Update comment count on the card
            const card = document.querySelector(`[data-doc-id="${docId}"]`);
            if (card) {
                const span = card.querySelector('.doc-comment-count');
                const count = (post.comments || []).length;
                if (span) span.innerHTML = `<i class="fas fa-comments"></i> ${count} comment${count !== 1 ? 's' : ''}`;
            }

        } catch (error) {
            console.error('Failed to refresh thread:', error);
        }
    }

    static init() {
        document.getElementById('submitCommentBtn')?.addEventListener('click', () => {
            CommentController.submitComment();
        });

        document.getElementById('startCommentBtn')?.addEventListener('click', () => {
            if (currentUser) {
                CommentController.enterUserMode();
            } else {
                ModalController.close('commentModal');
                ModalController.open('loginModal');
            }
        });

        document.getElementById('switchToSignInBtn')?.addEventListener('click', () => {
            ModalController.close('commentModal');
            ModalController.open('loginModal');
        });
    }
}


// ==========================================
// NAVIGATION CONTROLLER
// ==========================================

class NavigationController {
    constructor() {
        this.pages = {
            home:        document.getElementById('homePage'),
            resolutions: document.getElementById('resolutionsPage'),
            policyBoard: document.getElementById('policyBoardPage')
        };

        this.navLinks = {
            home:           document.getElementById('homeNavLink'),
            resolutions:    document.getElementById('resolutionsNavLink'),
            policyBoard:    document.getElementById('policyBoardNavLink'),
            accomplishment: document.getElementById('accomplishmentNavLink')
        };

        this.currentPage = 'home';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.showPage('home');
    }

    setupEventListeners() {
        this.navLinks.home?.addEventListener('click', (e) => { e.preventDefault(); this.showPage('home'); });
        this.navLinks.resolutions?.addEventListener('click', (e) => { e.preventDefault(); this.showPage('resolutions'); });
        this.navLinks.policyBoard?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPage('policyBoard');
            this.fetchAndRenderDocuments(); // ← fetch from API
        });
        this.navLinks.accomplishment?.addEventListener('click', (e) => {
            e.preventDefault();
            alert('Accomplishment Reports page coming soon!');
        });

        document.getElementById('applyFilterBtn')?.addEventListener('click', () => this.applyFilters());
    }

    showPage(pageName) {
        Object.values(this.pages).forEach(p => { if (p) p.style.display = 'none'; });
        if (this.pages[pageName]) {
            this.pages[pageName].style.display = 'block';
            this.currentPage = pageName;
        }
        this.updateActiveNav(pageName);
    }

    updateActiveNav(pageName) {
        Object.keys(this.navLinks).forEach(key => {
            this.navLinks[key]?.classList.toggle('active', key === pageName);
        });
    }

    // ==========================================
    // NEW: Fetch from get_posts then render
    // ==========================================
    async fetchAndRenderDocuments() {
        const container = document.getElementById('documentsContainer');
        if (!container) return;

        // 1. Show a loading state while fetching
        container.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-spinner fa-spin fa-2x" style="color: #c0392b;"></i>
                <p class="mt-3" style="color: #7f8c8d;">Loading documents...</p>
            </div>`;

        try {
            // 2. Call your Python endpoint
            const response = await fetch('api/get_posts');
            const result   = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to load documents.');
            }

            // 3. Map the API response fields to what renderDocuments() expects
            DOCUMENTS_DATA = (result.data || []).map(post => ({
                id:           post.website_post_id,
                category:     post.document_category   || 'Document',
                documentType: post.document_type        || '',
                title:        post.title,
                barangay:     post.barangay?.barangay_id   || '',
                barangayName: post.barangay?.barangay_name || '',
                year:         post.year ? String(post.year) : '',
                date:         post.published_at
                                ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                                : 'N/A',
                comments:     post.comments            || [],
                description:  post.description         || '',
                isFeatured:   false,
                fileUrl:      post.file_url            || null,
                portalStatus: post.portal_status,
            }));

            // 4. Only show published posts on the public portal
            const publishedDocs = DOCUMENTS_DATA.filter(d => d.portalStatus === 'published');

            if (publishedDocs.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-5">
                        <i class="fas fa-file-alt fa-4x" style="color: #ccc;"></i>
                        <h4 class="mt-3" style="color: #7f8c8d;">No Documents Available</h4>
                        <p style="color: #95a5a6;">No published documents at this time.</p>
                    </div>`;
                return;
            }

            // 5. Render the cards
            this.renderDocuments(publishedDocs);

            // 6. Populate filter dropdowns dynamically
            this.populateBarangayFilter();
            this.populateYearFilter(publishedDocs);

        } catch (error) {
            console.error('Error fetching documents:', error);
            container.innerHTML = `
                <div class="text-center py-5">
                    <i class="fas fa-exclamation-triangle fa-3x" style="color: #e74c3c;"></i>
                    <h4 class="mt-3" style="color: #7f8c8d;">Failed to Load Documents</h4>
                    <p style="color: #95a5a6;">${error.message}</p>
                    <button class="btn-featured mt-3" onclick="window.navigationController.fetchAndRenderDocuments()">
                        <i class="fas fa-redo me-2"></i> Try Again
                    </button>
                </div>`;
        }
    }

    renderDocuments(docs = DOCUMENTS_DATA) {
        const container = document.getElementById('documentsContainer');
        if (!container) return;
        container.innerHTML = '';

        docs.forEach(doc => {
            const commentCount = Array.isArray(doc.comments) ? doc.comments.length : 0;
            const card = document.createElement('div');
            card.className = `document-card ${doc.isFeatured ? 'card-featured' : ''}`;
            card.setAttribute('data-barangay', doc.barangay);
            card.setAttribute('data-year',     doc.year);
            card.setAttribute('data-doc-id',   doc.id);

            card.innerHTML = `
                <div class="card-content">
                    <div class="doc-header">
                        <span class="doc-category">${doc.category}</span>
                    </div>
                    <h3 class="doc-title">${doc.title}</h3>
                    <div class="doc-meta">
                        ${doc.barangayName ? `<span><i class="fas fa-map-marker-alt"></i> ${doc.barangayName}</span>` : ''}
                        <span><i class="fas fa-calendar-alt"></i> Updated ${doc.date}</span>
                        <span class="doc-comment-count">
                            <i class="fas fa-comments"></i> ${commentCount} comment${commentCount !== 1 ? 's' : ''}
                        </span>
                    </div>
                    <p class="doc-description">${doc.description}</p>
                    <div class="doc-divider"></div>
                    <div class="doc-actions">
                        <button class="btn-comment" data-doc-id="${doc.id}">
                            <i class="fas fa-comment me-1"></i> Comment
                        </button>
                        <button class="btn-view" data-file="${doc.fileUrl || ''}">
                            <i class="fas fa-eye me-1"></i> View
                        </button>
                        <button class="btn-download" data-file="${doc.fileUrl || ''}">
                            <i class="fas fa-download me-1"></i> Download
                        </button>
                    </div>
                </div>`;

            container.appendChild(card);
        });

        this.setupDocumentHandlers();
    }

    setupDocumentHandlers() {
        document.querySelectorAll('.btn-comment').forEach(btn => {
            btn.addEventListener('click', () => {
                const docId = parseInt(btn.getAttribute('data-doc-id'));
                CommentController.openForDoc(docId);
            });
        });

        document.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const file = btn.getAttribute('data-file');
                if (file) window.open(file, '_blank');
                else alert('No file available for this document.');
            });
        });

        document.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', () => {
                const file = btn.getAttribute('data-file');
                if (file) {
                    const a = document.createElement('a');
                    a.href = file;
                    a.download = '';
                    a.click();
                } else {
                    alert('No file available for this document.');
                }
            });
        });
    }

    async populateBarangayFilter() {
        const select = document.getElementById('barangayFilter');
        if (!select) return;

        // Don't reload if already populated
        if (select.options.length > 1) return;

        try {
            const response = await fetch('api/get_barangays');
            const result   = await response.json();

            if (!result.success || !result.data.length) return;

            result.data.forEach(b => {
                const option = document.createElement('option');
                option.value       = b.barangay_id;
                option.textContent = b.barangay_name;
                select.appendChild(option);
            });

        } catch (error) {
            console.error('Failed to load barangay filter:', error);
        }
    }

    populateYearFilter(docs) {
        const select = document.getElementById('yearFilter');
        if (!select) return;

        // Get unique years from the loaded documents
        const years = [...new Set(docs.map(d => d.year).filter(Boolean))].sort((a, b) => b - a);

        // Reset to just "All Years"
        select.innerHTML = '<option value="all">All Years</option>';

        years.forEach(year => {
            const option = document.createElement('option');
            option.value       = year;
            option.textContent = year;
            select.appendChild(option);
        });
    }

    applyFilters() {
        const selectedBarangay = document.getElementById('barangayFilter')?.value || 'all';
        const selectedYear     = document.getElementById('yearFilter')?.value     || 'all';

        // Filter from DOCUMENTS_DATA in memory
        const publishedDocs = DOCUMENTS_DATA.filter(d => d.portalStatus === 'published');

        const filtered = publishedDocs.filter(doc => {
            const barangayMatch = selectedBarangay === 'all' || String(doc.barangay) === selectedBarangay;
            const yearMatch     = selectedYear     === 'all' || String(doc.year)     === selectedYear;
            return barangayMatch && yearMatch;
        });

        // Re-render with filtered results
        this.renderDocuments(filtered);

        const noResults = document.getElementById('noResultsMessage');
        if (noResults) noResults.style.display = filtered.length === 0 ? 'block' : 'none';
    }
}


// ==========================================
// INIT
// ==========================================

document.addEventListener('DOMContentLoaded', function () {
    ModalController.init();
    AuthController.init();
    CommentController.init();
    window.navigationController = new NavigationController();
    console.log('SK Federation Portal - Initialized');
});