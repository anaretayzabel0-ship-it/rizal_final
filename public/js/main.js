/**
 * SK FEDERATION - TRANSPARENT GOVERNANCE
 * Main Application Script
 */

// ==========================================
// DATA
// Was hardcoded before — now fetched from API
// ==========================================

let DOCUMENTS_DATA = [];

// Matches the CSS "phone" breakpoint — used to decide whether the
// document viewer needs the Google Docs Viewer fallback (see below).
function isPhoneViewport() {
    return window.matchMedia('(max-width: 768px)').matches;
}

// Android Chrome (and most mobile browsers) can't render a PDF inline
// inside an <iframe> the way desktop Chrome does — instead of the file,
// they show a generic "here's a file, tap Open" card, which means an
// extra tap before the resident actually sees the document. Routing
// through Google's document viewer embed renders it inline immediately,
// so we only do this on phone widths; desktop keeps the direct file URL.
function getViewerSrc(fileUrl) {
    if (!fileUrl) return '';
    if (isPhoneViewport()) {
        return `https://docs.google.com/viewer?embedded=true&url=${encodeURIComponent(fileUrl)}`;
    }
    return fileUrl;
}

// Files live in Supabase Storage, a different origin from this page, so the
// <a download> attribute alone can't force a save the way it does for
// same-origin links — cross-origin clicks just navigate, and the browser
// decides how to handle that file type (e.g. opening a PDF inline instead
// of saving it). Supabase Storage has its own fix for this: appending
// ?download to the object URL makes the server respond with a
// Content-Disposition: attachment header, which forces a real download
// regardless of origin.
function getDownloadUrl(fileUrl) {
    if (!fileUrl) return fileUrl;
    const separator = fileUrl.includes('?') ? '&' : '?';
    return `${fileUrl}${separator}download`;
}

function triggerFileDownload(fileUrl) {
    if (!fileUrl) {
        alert('No file available for this document.');
        return;
    }
    const a = document.createElement('a');
    a.href = getDownloadUrl(fileUrl);
    a.download = '';
    a.click();
}

// Shared by the main "View" button and the mini "View" buttons on past
// versions — populates and opens the view-document modal.
function openDocumentViewer(doc, file) {
    document.getElementById('viewDocTitle').textContent = doc?.title || '';
    document.getElementById('viewDocMeta').textContent = doc
        ? `${doc.barangayName}  ·  Updated ${doc.date}`
        : '';

    const frame = document.getElementById('viewDocFrame');
    const empty = document.getElementById('viewDocEmpty');

    if (file) {
        frame.src = getViewerSrc(file);
        frame.style.display = 'block';
        empty.style.display = 'none';
    } else {
        frame.src = '';
        frame.style.display = 'none';
        empty.style.display = 'block';
    }

    ModalController.open('viewDocumentModal');
}


// ==========================================
// AUTH STATE
// ==========================================

let currentUser = null;
let commentMode = null;
let activeDocId = null;
let draftCommentText = '';
let draftCommentDocId = null;

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

        // Stop the embedded file from continuing to load in the background
        if (modalId === 'viewDocumentModal') {
            const frame = document.getElementById('viewDocFrame');
            if (frame) frame.src = '';
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

        // Mobile drawer's auth section mirrors the header buttons
        document.getElementById('drawerRegisterBtn')?.addEventListener('click', () => {
            AuthController.loadBarangays();
            ModalController.open('registerModal');
        });

        document.getElementById('drawerSignOutBtn')?.addEventListener('click', () => {
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
    }

    static setUser(user, options = {}) {
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

        // Mirror the same state into the mobile drawer's auth section
        document.getElementById('drawerRegisterBtn').style.display = 'none';
        const drawerPill = document.getElementById('drawerUserPill');
        drawerPill.style.display = 'flex';
        drawerPill.classList.remove('d-none');
        document.getElementById('drawerUserAvatar').textContent = initials;
        document.getElementById('drawerUserDisplayName').textContent = user.firstName;

        // Remember the session across visits/reloads, unless we're just
        // restoring from that same stored session on page load.
        if (!options.skipPersist) {
            try {
                localStorage.setItem('sk_portal_user', JSON.stringify(currentUser));
            } catch (e) {
                console.warn('Could not persist session:', e);
            }
        }
    }

    // Called once on page load. Restores currentUser + header UI from
    // a previously saved session, so the user stays signed in on return
    // visits instead of having to log in again every time.
    static restoreSession() {
        let stored = null;
        try {
            stored = JSON.parse(localStorage.getItem('sk_portal_user') || 'null');
        } catch (e) {
            stored = null;
        }

        if (stored && stored.userId) {
            AuthController.setUser(stored, { skipPersist: true });
        }
    }

    static signOut() {
        currentUser = null;
        commentMode = null;
        document.getElementById('headerLoginBtn').style.display = '';
        document.getElementById('headerRegisterBtn').style.display = '';
        document.getElementById('userPill').style.display = 'none';
        document.getElementById('drawerRegisterBtn').style.display = '';
        document.getElementById('drawerUserPill').style.display = 'none';
        try {
            localStorage.removeItem('sk_portal_user');
        } catch (e) {
            console.warn('Could not clear stored session:', e);
        }
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

        // Compose box is now visible to everyone, logged in or not.
        // Only the "signed in as ___" banner depends on auth state.
        document.getElementById('composeBox').style.display = 'flex';

        if (currentUser) {
            CommentController.enterUserMode();
        }

        ModalController.open('commentModal');
    }

    static resetComposeArea() {
        const banner = document.getElementById('composeUserBanner');
        if (banner) banner.style.display = 'none';
        const textarea = document.getElementById('commentTextarea');
        if (textarea) textarea.value = '';
    }

    static enterUserMode() {
        if (!currentUser) return;
        commentMode = 'user';
        const initials = (currentUser.firstName[0] + currentUser.lastName[0]).toUpperCase();
        document.getElementById('composeAvatar').textContent = initials;
        document.getElementById('composeUserName').textContent = `${currentUser.firstName} ${currentUser.lastName}`;

        document.getElementById('composeUserBanner').style.display = 'flex';
        document.getElementById('composeBox').style.display = 'flex';

        // Restore a draft comment typed before the user was prompted to sign in
        if (draftCommentText && draftCommentDocId === activeDocId) {
            const textarea = document.getElementById('commentTextarea');
            if (textarea) textarea.value = draftCommentText;
        }
        draftCommentText = '';
        draftCommentDocId = null;
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

        thread.innerHTML = comments.map((c, idx) => `
            <div>
                ${CommentController.renderCommentNode(c, false)}
                ${idx < comments.length - 1 ? '<div class="sk-comment-divider"></div>' : ''}
            </div>`
        ).join('');
    }

    // Renders one comment node (top-level or any depth of reply -- every
    // node from build_comment_tree() has the same shape: comment_id,
    // content, created_at, author{first_name,last_name,role}, replies) and
    // recurses into node.replies. Any authenticated user, resident or SK,
    // can reply to any node, so there's no branching on where it came from.
    static renderCommentNode(node, isReply) {
        const personObj = node.author;
        const author = `${personObj?.first_name || ''} ${personObj?.last_name || ''}`.trim() || 'Resident';
        const initials = (author[0] + (author.split(' ')[1]?.[0] || '')).toUpperCase();
        const time = node.created_at ? new Date(node.created_at).toLocaleDateString() : '';

        // Anyone whose role isn't 'resident' is shown with the official badge.
        const isOfficial = !!personObj?.role && personObj.role !== 'resident';

        const targetId = node.comment_id;
        const childReplies = (node.replies || []).map(child => CommentController.renderCommentNode(child, true)).join('');

        const itemClass = isReply
            ? `sk-reply-item ${isOfficial ? '' : 'sk-reply-item--resident'}`
            : 'sk-comment-item';

        return `
            <div class="${itemClass}">
                <div class="sk-comment-avatar ${isOfficial ? 'sk-comment-avatar--official' : ''}">
                    ${initials || '?'}
                </div>
                <div class="sk-comment-bubble ${isOfficial ? 'sk-comment-bubble--official' : ''}">
                    <div class="sk-comment-meta">
                        <span class="sk-comment-author">${author}</span>
                        ${isOfficial ? '<span class="sk-comment-badge">Official</span>' : ''}
                        <span class="sk-comment-time">${time}</span>
                    </div>
                    <p class="sk-comment-text">${node.content || ''}</p>
                    <div class="${isReply ? 'sk-reply-item__actions' : 'sk-comment-actions'}">
                        ${isReply ? '' : `
                        <button class="sk-comment-action-btn">
                            <i class="fas fa-thumbs-up"></i> ${node.likes || 0}
                        </button>`}
                        <button class="sk-comment-action-btn btn-reply-to-reply" data-target-id="${targetId}">Reply</button>
                    </div>
                </div>
            </div>
            ${CommentController.renderReplyCompose(targetId)}
            ${childReplies ? `<div class="${isReply ? 'sk-subreply-thread' : 'sk-reply-thread'}">${childReplies}</div>` : ''}`;
    }

    // The little textarea+send box that toggles open under a "Reply"
    // button. Keyed by comment_id -- every comment, at any depth, has
    // exactly one id now, so there's no need to namespace by type.
    static renderReplyCompose(targetId) {
        return `
        <div class="sk-reply-compose" id="replyCompose-${targetId}">
            <textarea class="sk-reply-compose-input" id="replyComposeInput-${targetId}" rows="1" placeholder="Write a reply..."></textarea>
            <button class="sk-reply-compose-send" data-target-id="${targetId}">
                <i class="fas fa-paper-plane"></i>
            </button>
        </div>`;
    }

    static async submitComment() {
        const textarea = document.getElementById('commentTextarea');
        const text     = textarea?.value.trim();

        // Must be logged in — stash the draft and prompt sign-in
        if (!currentUser) {
            draftCommentText = textarea?.value || '';
            draftCommentDocId = activeDocId;
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
                    author_id:       currentUser.userId,
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

    static async submitReplyToReply(targetId) {
        const textarea = document.getElementById(`replyComposeInput-${targetId}`);
        const text = textarea?.value.trim();

        // Must be logged in — stash the draft and prompt sign-in
        if (!currentUser) {
            draftCommentText = textarea?.value || '';
            draftCommentDocId = activeDocId;
            ModalController.close('commentModal');
            ModalController.open('loginModal');
            return;
        }

        if (!text) {
            textarea.style.border = '2px solid #e74c3c';
            setTimeout(() => textarea.style.border = '', 1500);
            return;
        }

        const sendBtn = document.querySelector(`.sk-reply-compose-send[data-target-id="${targetId}"]`);
        if (sendBtn) { sendBtn.disabled = true; sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }

        // Any comment node -- top-level or a reply at any depth -- is
        // targeted the same way now: parent_id.
        const body = {
            website_post_id: activeDocId,
            author_id:       currentUser.userId,
            content:         text,
            parent_id:       targetId
        };

        try {
            const response = await fetch('api/post_comment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            const result = await response.json();

            if (!result.success) {
                AuthController.showToast(result.message || 'Failed to post reply.');
                return;
            }

            await CommentController.refreshThread(activeDocId);
            AuthController.showToast('Reply posted successfully!');

        } catch (error) {
            console.error('Reply error:', error);
            AuthController.showToast('Something went wrong. Please try again.');
        } finally {
            if (sendBtn) { sendBtn.disabled = false; sendBtn.innerHTML = '<i class="fas fa-paper-plane"></i>'; }
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

        // Delegated handlers: the comment thread is rebuilt on every render,
        // so bind once on the container instead of per-element.
        const thread = document.getElementById('commentThread');

        thread?.addEventListener('click', (e) => {
            const replyToggleBtn = e.target.closest('.btn-reply-to-reply');
            if (replyToggleBtn) {
                const targetId = replyToggleBtn.getAttribute('data-target-id');
                const compose = document.getElementById(`replyCompose-${targetId}`);
                if (compose) {
                    compose.classList.toggle('sk-reply-compose--open');
                    if (compose.classList.contains('sk-reply-compose--open')) {
                        document.getElementById(`replyComposeInput-${targetId}`)?.focus();
                    }
                }
                return;
            }

            const sendBtn = e.target.closest('.sk-reply-compose-send');
            if (sendBtn) {
                const targetId = sendBtn.getAttribute('data-target-id');
                CommentController.submitReplyToReply(targetId);
            }
        });

        // Enter (without Shift) submits the reply, same as the main composer
        thread?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && e.target.classList.contains('sk-reply-compose-input')) {
                e.preventDefault();
                const targetId = e.target.id.replace('replyComposeInput-', '');
                CommentController.submitReplyToReply(targetId);
            }
        });
    }
}


// ==========================================
// NAVIGATION CONTROLLER
// ==========================================

// ==========================================
// MOBILE NAV DRAWER
// ==========================================
// Phone widths only (see CSS @media max-width:768px) — the hamburger
// button no longer uses Bootstrap's data-bs-toggle="collapse" (which
// pushes page content down); instead this toggles a plain .show class
// that the phone-width CSS turns into a slide-in overlay drawer.
// At tablet/desktop widths this class has no special effect, so
// behavior there is unchanged.

class NavDrawerController {
    static init() {
        const toggle   = document.getElementById('navDrawerToggle');
        const drawer   = document.getElementById('mainNavbar');
        const backdrop = document.getElementById('navDrawerBackdrop');
        const closeBtn = document.getElementById('navDrawerClose');

        if (!toggle || !drawer) return;

        const open = () => {
            drawer.classList.add('show');
            backdrop?.classList.add('is-visible');
            document.body.style.overflow = 'hidden';
        };

        const close = () => {
            drawer.classList.remove('show');
            backdrop?.classList.remove('is-visible');
            document.body.style.overflow = '';
        };

        toggle.addEventListener('click', () => {
            drawer.classList.contains('show') ? close() : open();
        });

        backdrop?.addEventListener('click', close);
        closeBtn?.addEventListener('click', close);

        // Close the drawer once the resident actually navigates —
        // but let the "About us" dropdown toggle open/closed normally.
        drawer.querySelectorAll('.nav-link:not(.dropdown-toggle), .dropdown-item').forEach(link => {
            link.addEventListener('click', close);
        });
        document.getElementById('drawerRegisterBtn')?.addEventListener('click', close);
        document.getElementById('drawerSignOutBtn')?.addEventListener('click', close);

        // If the window is resized past phone width while open, reset it
        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) close();
        });
    }
}


// ==========================================
// ABOUT US
// Barangays load from GET /api/get_barangays (real data).
// SK Officials load per-barangay from GET /api/get_sk_officials?barangay_id=X,
// which calls the get_sk_officials_by_barangay Supabase RPC.
// Contact info has no schema/table yet, so that sub-page shows a
// "not on file" placeholder per barangay until those fields exist.
// ==========================================
class AboutUsController {
    constructor() {
        this.officialsListEl   = document.getElementById('officialsBarangayList');
        this.officialsDetailEl = document.getElementById('officialsDetailView');
        this.officialsGridEl   = document.getElementById('officialsDetailGrid');
        this.officialsTitleEl  = document.getElementById('officialsDetailTitle');

        this.contactListEl   = document.getElementById('contactBarangayList');
        this.contactDetailEl = document.getElementById('contactDetailView');
        this.contactGridEl   = document.getElementById('contactDetailGrid');

        this.barangays = []; // populated by loadBarangays()

        this.init();
    }

    init() {
        document.getElementById('officialsBackBtn')?.addEventListener('click', () => this.resetView('officials'));
        document.getElementById('contactBackBtn')?.addEventListener('click', () => this.resetView('contact'));

        this.loadBarangays();
    }

    async loadBarangays() {
        this.renderLoadingList(this.officialsListEl);
        this.renderLoadingList(this.contactListEl);

        try {
            const response = await fetch('api/get_barangays');
            const result   = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to load barangays.');
            }

            this.barangays = result.data || [];

            this.renderBarangayList(
                this.officialsListEl,
                () => 'View SK officials',
                (id) => this.showOfficials(id)
            );

            this.renderBarangayList(
                this.contactListEl,
                () => 'View contact info',
                (id) => this.showContact(id)
            );
        } catch (error) {
            console.error('Failed to load barangays:', error);
            this.renderErrorList(this.officialsListEl, 'Could not load barangays.');
            this.renderErrorList(this.contactListEl, 'Could not load barangays.');
        }
    }

    renderLoadingList(container) {
        if (!container) return;
        container.innerHTML = `
            <div class="col-12 text-center py-4">
                <i class="fas fa-spinner fa-spin" style="color: #c0392b;"></i>
                <span class="ms-2" style="color: #7f8c8d; font-size: 0.9rem;">Loading barangays...</span>
            </div>`;
    }

    renderErrorList(container, message) {
        if (!container) return;
        container.innerHTML = `
            <div class="col-12 text-center py-4" style="color: #95a5a6;">
                <i class="fas fa-triangle-exclamation"></i>
                <span class="ms-2" style="font-size: 0.9rem;">${message}</span>
            </div>`;
    }

    // Renders the "choose a barangay" grid shared by both sub-pages.
    renderBarangayList(container, metaFn, onSelect) {
        if (!container) return;

        if (this.barangays.length === 0) {
            container.innerHTML = `
                <div class="col-12 text-center py-4" style="color: #95a5a6;">
                    <span style="font-size: 0.9rem;">No barangays found.</span>
                </div>`;
            return;
        }

        container.innerHTML = this.barangays.map(b => `
            <div class="col-6 col-md-4">
                <div class="barangay-select-card" data-barangay-id="${b.barangay_id}">
                    <div class="barangay-select-icon"><i class="fas fa-map-marker-alt"></i></div>
                    <div class="barangay-select-info">
                        <div class="barangay-select-name">${b.barangay_name}</div>
                        <div class="barangay-select-meta">${metaFn(b)}</div>
                    </div>
                    <i class="fas fa-chevron-right barangay-select-chevron"></i>
                </div>
            </div>`).join('');

        container.querySelectorAll('.barangay-select-card').forEach(card => {
            card.addEventListener('click', () => onSelect(card.dataset.barangayId));
        });
    }

    async showOfficials(barangayId) {
        this.officialsListEl.style.display   = 'none';
        this.officialsDetailEl.style.display = 'block';
        this.officialsTitleEl.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Loading officials...`;
        this.officialsGridEl.innerHTML = '';
        this.officialsDetailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            const response = await fetch(`api/get_sk_officials?barangay_id=${encodeURIComponent(barangayId)}`);
            const result   = await response.json();

            if (!result.success) {
                throw new Error(result.message || 'Failed to load SK officials.');
            }

            const data      = result.data || {};
            const officials = data.officials || [];

            this.officialsTitleEl.innerHTML = `<i class="fas fa-map-marker-alt"></i> ${data.barangay_name || 'Barangay'} — SK Officials`;

            if (officials.length === 0) {
                this.officialsGridEl.innerHTML = `
                    <div class="col-12 text-center py-4" style="color: #95a5a6;">
                        <i class="fas fa-user-slash fa-2x mb-2 d-block"></i>
                        <span style="font-size: 0.9rem;">No SK officials on file yet for this barangay.</span>
                    </div>`;
                return;
            }

            this.officialsGridEl.innerHTML = officials.map(o => {
                const fullName = `${o.first_name || ''} ${o.last_name || ''}`.trim() || 'Unnamed Official';
                const position = o.position
                    ? o.position.charAt(0).toUpperCase() + o.position.slice(1)
                    : 'SK Official';
                return `
                    <div class="col-6 col-md-4 col-lg-3">
                        <div class="official-card">
                            <div class="official-photo">
                                <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=0d3b4f&color=fff&size=200" alt="${fullName}">
                            </div>
                            <h4 class="official-name">${fullName}</h4>
                            <p class="official-position">${position}</p>
                            ${o.email ? `<span class="official-barangay"><i class="fas fa-envelope"></i>${o.email}</span>` : ''}
                        </div>
                    </div>`;
            }).join('');
        } catch (error) {
            console.error('Failed to load SK officials:', error);
            this.officialsTitleEl.innerHTML = '';
            this.officialsGridEl.innerHTML = `
                <div class="col-12 text-center py-4" style="color: #95a5a6;">
                    <span style="font-size: 0.9rem;">Could not load SK officials. Please try again.</span>
                </div>`;
        }
    }

    // Contact fields (Facebook page, phone, email per barangay) aren't in
    // the database yet -- shows a clear placeholder instead of fake data.
    showContact(barangayId) {
        const barangay = this.barangays.find(b => String(b.barangay_id) === String(barangayId));
        if (!barangay) return;

        this.contactGridEl.innerHTML = `
            <div class="col-md-6">
                <div class="contact-card">
                    <h4 class="contact-barangay-name"><i class="fas fa-map-marker-alt"></i>${barangay.barangay_name}</h4>
                    <p style="color: #95a5a6; font-size: 0.88rem; margin: 0;">
                        <i class="fas fa-circle-info me-1"></i>
                        Contact details for this barangay haven't been added yet.
                    </p>
                </div>
            </div>`;

        this.contactListEl.style.display   = 'none';
        this.contactDetailEl.style.display = 'block';
        this.contactDetailEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Returns a sub-page to its "choose a barangay" list.
    // which: 'officials' | 'contact'
    resetView(which) {
        if (which === 'officials') {
            this.officialsDetailEl.style.display = 'none';
            this.officialsListEl.style.display   = '';
        } else {
            this.contactDetailEl.style.display = 'none';
            this.contactListEl.style.display   = '';
        }
    }
}


class NavigationController {
    constructor() {
        this.pages = {
            home:        document.getElementById('homePage'),
            policyBoard: document.getElementById('policyBoardPage'),
            aboutUs:     document.getElementById('aboutUsPage')
        };

        this.navLinks = {
            home:           document.getElementById('homeNavLink'),
            policyBoard:    document.getElementById('policyBoardNavLink'),
            accomplishment: document.getElementById('accomplishmentNavLink'),
            aboutUs:        document.getElementById('aboutDropdown')
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
        this.navLinks.policyBoard?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPage('policyBoard');
            this.fetchAndRenderDocuments(); // ← fetch from API
        });
        this.navLinks.accomplishment?.addEventListener('click', (e) => {
            e.preventDefault();
            alert('Accomplishment Reports page coming soon!');
        });

        // About Us dropdown → open the About Us page, then scroll to the
        // relevant section (Mission & Vision / SK Officials / Contact Us).
        document.getElementById('missionVisionLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPage('aboutUs');
            this.scrollToSection('missionVisionSection');
        });
        document.getElementById('skOfficialsLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPage('aboutUs');
            window.aboutUsController?.resetView('officials');
            this.scrollToSection('skOfficialsSection');
        });
        document.getElementById('contactUsLink')?.addEventListener('click', (e) => {
            e.preventDefault();
            this.showPage('aboutUs');
            window.aboutUsController?.resetView('contact');
            this.scrollToSection('contactUsSection');
        });

        document.getElementById('applyFilterBtn')?.addEventListener('click', () => this.applyFilters());
        document.getElementById('sortFilter')?.addEventListener('change', () => this.applyFilters());

        // Live search-as-you-type (debounced), across title, document type,
        // category, year, and barangay.
        const searchInput = document.getElementById('documentSearchInput');
        const searchClear = document.getElementById('documentSearchClear');
        let searchDebounceTimer = null;

        searchInput?.addEventListener('input', () => {
            if (searchClear) searchClear.style.display = searchInput.value ? 'flex' : 'none';
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => this.applyFilters(), 250);
        });

        searchClear?.addEventListener('click', () => {
            if (!searchInput) return;
            searchInput.value = '';
            searchClear.style.display = 'none';
            this.applyFilters();
            searchInput.focus();
        });
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

    // Smoothly scrolls to a section within the currently-shown page.
    // A brief delay lets the page's display switch to "block" first so
    // the browser calculates the correct scroll position.
    scrollToSection(sectionId) {
        setTimeout(() => {
            document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
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
                category:     post.category?.document_category || 'Document',
                documentType: post.type?.document_type          || '',
                title:        post.title,
                barangay:     post.barangay?.barangay_id   || '',
                barangayName: post.barangay?.barangay_name || '',
                year:         post.year ? String(post.year) : '',
                date:         post.published_at
                                ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
                                : 'N/A',
                publishedAt:  post.published_at || null,
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

    // Group documents by barangay + document type, so each type (e.g. CBYDP)
    // shows a single card for its current/latest year, with older years
    // tucked away in an expandable "past versions" list.
    groupDocumentsByType(docs) {
        const groups = new Map();

        docs.forEach(doc => {
            const key = `${doc.barangay || 'na'}||${doc.documentType || doc.category || 'doc'}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(doc);
        });

        const result = [];
        groups.forEach(groupDocs => {
            // Newest upload first (falls back to year if no upload timestamp).
            // Docs without either fall to the end.
            const sorted = [...groupDocs].sort((a, b) => {
                const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
                const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
                if (aTime !== bTime) return bTime - aTime;
                return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
            });
            result.push({
                primary: sorted[0],
                older:   sorted.slice(1)
            });
        });

        return result;
    }

    // Reads the "Sort By" dropdown on the Policy Board page (defaults to newest upload first).
    getSortMode() {
        return document.getElementById('sortFilter')?.value || 'newest';
    }

    // Orders the grouped document cards by their primary (most recent) document's
    // upload timestamp, so the whole board reflects newest/oldest uploads.
    sortGroups(groups, sortMode = this.getSortMode()) {
        const getTime = (doc) => doc.publishedAt ? new Date(doc.publishedAt).getTime() : 0;
        const sorted = [...groups].sort((a, b) => {
            const diff = getTime(b.primary) - getTime(a.primary);
            return sortMode === 'oldest' ? -diff : diff;
        });
        return sorted;
    }

    renderDocuments(docs = DOCUMENTS_DATA, sortMode = this.getSortMode()) {
        const container = document.getElementById('documentsContainer');
        if (!container) return;
        container.innerHTML = '';

        const groups = this.sortGroups(this.groupDocumentsByType(docs), sortMode);

        groups.forEach(({ primary: doc, older }) => {
            const commentCount = Array.isArray(doc.comments) ? doc.comments.length : 0;
            const card = document.createElement('div');
            card.className = `document-card ${doc.isFeatured ? 'card-featured' : ''}`;
            card.setAttribute('data-barangay', doc.barangay);
            card.setAttribute('data-year',     doc.year);
            card.setAttribute('data-doc-id',   doc.id);

            const pastId = `pastVersions-${doc.id}`;

            card.innerHTML = `
                <div class="card-content">
                    <div class="doc-header">
                        <div class="doc-badges">
                            ${doc.documentType ? `<span class="doc-type-badge">${doc.documentType}</span>` : ''}
                        </div>
                        <span class="doc-year-badge"><i class="fas fa-calendar-alt me-1"></i>${doc.year || 'N/A'}</span>
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
                    ${older.length > 0 ? `
                    <button class="doc-past-toggle" data-target="${pastId}">
                        <i class="fas fa-history me-1"></i>
                        View ${older.length} past version${older.length !== 1 ? 's' : ''}
                        <i class="fas fa-chevron-down doc-past-toggle__icon"></i>
                    </button>
                    <div class="doc-past-versions" id="${pastId}" style="display: none;">
                        ${older.map(o => `
                            <div class="doc-past-item">
                                <div class="doc-past-item__info">
                                    <span class="doc-past-item__year">${o.year || 'N/A'}</span>
                                    <span class="doc-past-item__title">${o.title}</span>
                                    <span class="doc-past-item__date">Updated ${o.date}</span>
                                </div>
                                <div class="doc-past-item__actions">
                                    <button class="btn-view-sm" data-doc-id="${o.id}" data-file="${o.fileUrl || ''}" title="View">
                                        <i class="fas fa-eye"></i>
                                    </button>
                                    <button class="btn-download-sm" data-file="${o.fileUrl || ''}" title="Download">
                                        <i class="fas fa-download"></i>
                                    </button>
                                </div>
                            </div>`).join('')}
                    </div>` : ''}
                    <div class="doc-divider"></div>
                    <div class="doc-actions">
                        <button class="btn-comment" data-doc-id="${doc.id}">
                            <i class="fas fa-comment me-1"></i> <span>Comment</span>
                        </button>
                        <button class="btn-view" data-doc-id="${doc.id}" data-file="${doc.fileUrl || ''}">
                            <i class="fas fa-eye me-1"></i> <span>View</span>
                        </button>
                        <button class="btn-download" data-file="${doc.fileUrl || ''}">
                            <i class="fas fa-download me-1"></i> <span>Download</span>
                        </button>
                    </div>
                </div>`;

            // Clicking anywhere on the card opens the viewer -- except on a
            // button (Comment/View/Download/mini view/mini download) or
            // inside the past-versions panel, which each have their own
            // specific behavior already wired below.
            card.addEventListener('click', (e) => {
                if (e.target.closest('button, .doc-past-versions')) return;
                openDocumentViewer(doc, doc.fileUrl);
            });

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
                const docId = parseInt(btn.getAttribute('data-doc-id'));
                const file  = btn.getAttribute('data-file');
                const doc   = DOCUMENTS_DATA.find(d => d.id === docId);
                openDocumentViewer(doc, file);
            });
        });

        document.querySelectorAll('.btn-download').forEach(btn => {
            btn.addEventListener('click', () => {
                triggerFileDownload(btn.getAttribute('data-file'));
            });
        });

        // Toggle the "past versions" list open/closed
        document.querySelectorAll('.doc-past-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-target');
                const panel = document.getElementById(targetId);
                if (!panel) return;

                const isOpen = panel.style.display !== 'none';
                panel.style.display = isOpen ? 'none' : 'block';
                btn.classList.toggle('doc-past-toggle--open', !isOpen);
            });
        });

        // Mini "view" buttons inside the past-versions list
        document.querySelectorAll('.btn-view-sm').forEach(btn => {
            btn.addEventListener('click', () => {
                const docId = parseInt(btn.getAttribute('data-doc-id'));
                const file  = btn.getAttribute('data-file');
                const doc   = DOCUMENTS_DATA.find(d => d.id === docId);
                openDocumentViewer(doc, file);
            });
        });

        // Mini "download" buttons inside the past-versions list
        document.querySelectorAll('.btn-download-sm').forEach(btn => {
            btn.addEventListener('click', () => {
                triggerFileDownload(btn.getAttribute('data-file'));
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
        const searchQuery      = (document.getElementById('documentSearchInput')?.value || '').trim().toLowerCase();

        // Filter from DOCUMENTS_DATA in memory
        const publishedDocs = DOCUMENTS_DATA.filter(d => d.portalStatus === 'published');

        const filtered = publishedDocs.filter(doc => {
            const barangayMatch = selectedBarangay === 'all' || String(doc.barangay) === selectedBarangay;
            const yearMatch     = selectedYear     === 'all' || String(doc.year)     === selectedYear;
            const searchMatch   = !searchQuery || this.documentMatchesSearch(doc, searchQuery);
            return barangayMatch && yearMatch && searchMatch;
        });

        // Re-render with filtered results
        this.renderDocuments(filtered);

        const noResults = document.getElementById('noResultsMessage');
        if (noResults) noResults.style.display = filtered.length === 0 ? 'block' : 'none';
    }

    // Checks a document's title, document type, category, year, and
    // barangay name against the search query.
    documentMatchesSearch(doc, query) {
        const searchableFields = [
            doc.title,
            doc.documentType,
            doc.category,
            doc.year,
            doc.barangayName
        ];

        return searchableFields.some(field =>
            String(field || '').toLowerCase().includes(query)
        );
    }
}


// ==========================================
// INIT
// ==========================================

// Live date/time display in the header (upper right)
function updateHeaderDateTime() {
    const el = document.getElementById('headerDateTimeText');
    if (!el) return;
    const now = new Date();
    const formatted = now.toLocaleString('en-US', {
        weekday: 'short',
        month:   'short',
        day:     'numeric',
        year:    'numeric',
        hour:    'numeric',
        minute:  '2-digit'
    });
    el.textContent = formatted;
}

document.addEventListener('DOMContentLoaded', function () {
    updateHeaderDateTime();
    setInterval(updateHeaderDateTime, 1000 * 30); // refresh every 30s

    ModalController.init();
    AuthController.init();
    AuthController.restoreSession();
    CommentController.init();
    NavDrawerController.init();
    window.aboutUsController = new AboutUsController();
    window.navigationController = new NavigationController();
    console.log('SK Federation Portal - Initialized');
});