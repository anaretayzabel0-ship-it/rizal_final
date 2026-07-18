"""
api/index.py
Single Vercel Python entrypoint (Flask app).

Vercel's current Python runtime expects ONE entrypoint file (app.py, index.py,
server.py, main.py, wsgi.py, or asgi.py) exposing a Flask/FastAPI/Django `app`
variable. All routes are defined inside this one app.

Currently implemented:
  POST /api/login
  POST /api/register
  GET  /api/get_barangays
  GET  /api/get_posts
  POST /api/post_comment
"""

import os
import re
import urllib.request
import urllib.error
import urllib.parse
import json
import pickle

import bcrypt
from flask import Flask, request, jsonify

app = Flask(__name__)

SUPABASE_URL = os.environ.get(
    "SUPABASE_URL",
    "https://ttsgeniubfkcexitfqsd.supabase.co"
)
SUPABASE_KEY = os.environ.get(
    "SUPABASE_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR0c2dlbml1YmZrY2V4aXRmcXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjQzMTEsImV4cCI6MjA5MzU0MDMxMX0.9zmGPUoxRnkRuLsC0-w9C-6p5q034o9-vi_q2i7QUy8"
)

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---- Sentiment classifier (for auto-flagging negative/toxic comments) ----
# vectorizer.pkl / sentiment_model.pkl must sit alongside this file (api/).
# Loaded once at cold start, reused across requests within the same
# serverless function instance.
_SENTIMENT_DIR = os.path.dirname(os.path.abspath(__file__))
sentiment_vectorizer = None
sentiment_model = None
try:
    with open(os.path.join(_SENTIMENT_DIR, "vectorizer.pkl"), "rb") as f:
        sentiment_vectorizer = pickle.load(f)
    with open(os.path.join(_SENTIMENT_DIR, "sentiment_model.pkl"), "rb") as f:
        sentiment_model = pickle.load(f)
except FileNotFoundError:
    # Sentiment model files not deployed yet -- comments will simply not
    # be auto-flagged until vectorizer.pkl / sentiment_model.pkl are added.
    pass


def is_comment_negative(text):
    """Returns True if the comment should be auto-flagged for review."""
    if sentiment_vectorizer is None or sentiment_model is None:
        return False
    try:
        vec = sentiment_vectorizer.transform([text])
        prediction = sentiment_model.predict(vec)[0]
        return bool(prediction == 1)
    except Exception:
        # Never let a scoring failure block a comment from posting.
        return False


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


def _verify_password(plain_password, hashed_password):
    """
    PHP's password_hash() (PASSWORD_BCRYPT) produces hashes prefixed with $2y$.
    Python's bcrypt library only recognizes $2a$/$2b$/$2x$ prefixes, so we
    normalize $2y$ -> $2b$ before checking. The hash payload itself is
    byte-for-byte compatible between PHP and Python bcrypt implementations.
    """
    normalized = hashed_password
    if normalized.startswith("$2y$"):
        normalized = "$2b$" + normalized[4:]

    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), normalized.encode("utf-8"))
    except ValueError:
        return False


def _supabase_get(path_and_query):
    url = f"{SUPABASE_URL.rstrip('/')}{path_and_query}"
    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return resp.status, resp.read().decode("utf-8")


@app.route("/api/login", methods=["GET", "POST", "OPTIONS"])
def login():
    if request.method == "OPTIONS":
        return "", 204

    if request.method == "GET":
        return jsonify({
            "success": True,
            "message": "SK Federation API Endpoint is active. Please send a POST request with authentication credentials to login."
        }), 200

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""

    # ---- Validate inputs ----
    if not email or not password:
        return jsonify({
            "success": False,
            "message": "Email and password are required."
        }), 400

    if not EMAIL_RE.match(email):
        return jsonify({
            "success": False,
            "message": "Invalid email address."
        }), 400

    # ---- Fetch user by email from Supabase ----
    select_fields = (
        "user_id,first_name,last_name,middle_initial,email,"
        "password,status,position,role_id,barangay_id"
    )
    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/users"
        f"?email=eq.{urllib.parse.quote(email)}"
        f"&select={select_fields}"
    )

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError:
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 200:
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500

    users = json.loads(response_body) if response_body else []

    # ---- Check if user exists ----
    if not users:
        return jsonify({
            "success": False,
            "message": "Incorrect email or password."
        }), 401

    user = users[0]

    # ---- Check account status ----
    if user.get("status") == "inactive":
        return jsonify({
            "success": False,
            "message": "Your account has been deactivated. Please contact the SK Admin."
        }), 403

    if user.get("status") == "pending":
        return jsonify({
            "success": False,
            "message": "Your account is pending approval. Please wait for confirmation."
        }), 403

    # ---- Verify password ----
    if not _verify_password(password, user.get("password", "")):
        return jsonify({
            "success": False,
            "message": "Incorrect email or password."
        }), 401

    # ---- Return safe user data (never return password) ----
    return jsonify({
        "success": True,
        "message": "Login successful.",
        "user": {
            "userId": user.get("user_id"),
            "firstName": user.get("first_name"),
            "lastName": user.get("last_name"),
            "middleInitial": user.get("middle_initial"),
            "email": user.get("email"),
            "position": user.get("position"),
            "barangayId": user.get("barangay_id"),
        }
    }), 200


@app.route("/api/register", methods=["POST", "OPTIONS"])
def register():
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}

    first_name = (data.get("firstName") or "").strip()
    last_name = (data.get("lastName") or "").strip()
    middle_initial = (data.get("middleInitial") or "").strip()
    email = (data.get("email") or "").strip()
    try:
        barangay_id = int(data.get("barangayId") or 0)
    except (TypeError, ValueError):
        barangay_id = 0
    password = data.get("password") or ""
    confirm_password = data.get("confirmPassword") or ""

    # ---- Validate ----
    errors = {}
    if not first_name:
        errors["firstName"] = "First name is required."
    if not last_name:
        errors["lastName"] = "Last name is required."
    if not email:
        errors["email"] = "Email is required."
    elif not EMAIL_RE.match(email):
        errors["email"] = "Invalid email address."
    if barangay_id <= 0:
        errors["barangayId"] = "Please select your barangay."
    if not password:
        errors["password"] = "Password is required."
    elif len(password) < 8:
        errors["password"] = "Password must be at least 8 characters."
    if password != confirm_password:
        errors["confirmPassword"] = "Passwords do not match."

    if errors:
        return jsonify({
            "success": False,
            "errors": errors
        }), 422

    # ---- Check if email already exists in Supabase ----
    try:
        _, check_body = _supabase_get(
            f"/rest/v1/users?email=eq.{urllib.parse.quote(email)}&select=user_id"
        )
    except (urllib.error.HTTPError, urllib.error.URLError):
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500

    existing = json.loads(check_body) if check_body else []
    if existing:
        return jsonify({
            "success": False,
            "errors": {"email": "This email is already registered."}
        }), 409

    # ---- Get resident role_id ----
    try:
        _, role_body = _supabase_get(
            "/rest/v1/roles?role_name=eq.resident&select=role_id"
        )
    except (urllib.error.HTTPError, urllib.error.URLError):
        return jsonify({
            "success": False,
            "message": "Server error. Please try again."
        }), 500

    roles = json.loads(role_body) if role_body else []
    if not roles:
        return jsonify({
            "success": False,
            "message": "Role 'resident' not found. Please contact the administrator."
        }), 500

    role_id = roles[0]["role_id"]

    # ---- Hash password ----
    hashed_password = bcrypt.hashpw(
        password.encode("utf-8"), bcrypt.gensalt()
    ).decode("utf-8")

    # ---- Insert new user into Supabase ----
    insert_url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/users"

    new_user = {
        "role_id": role_id,
        "barangay_id": barangay_id,
        "first_name": first_name,
        "last_name": last_name,
        "middle_initial": middle_initial or None,
        "email": email,
        "password": hashed_password,
        "status": "active",
        "position": "resident",
    }

    req = urllib.request.Request(
        insert_url,
        data=json.dumps(new_user).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=representation",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            details = json.loads(error_body)
        except json.JSONDecodeError:
            details = error_body
        return jsonify({
            "success": False,
            "message": "Failed to create account. Please try again.",
            "details": details
        }), 500
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 201:
        try:
            details = json.loads(response_body)
        except json.JSONDecodeError:
            details = response_body
        return jsonify({
            "success": False,
            "message": "Failed to create account. Please try again.",
            "details": details
        }), 500

    created = json.loads(response_body)[0]

    return jsonify({
        "success": True,
        "message": "Account created successfully! You can now log in.",
        "user": {
            "userId": created.get("user_id"),
            "firstName": created.get("first_name"),
            "lastName": created.get("last_name"),
            "email": created.get("email"),
            "status": created.get("status"),
        }
    }), 200


@app.route("/api/get_barangays", methods=["GET", "OPTIONS"])
def get_barangays():
    if request.method == "OPTIONS":
        return "", 204

    url = (
        f"{SUPABASE_URL.rstrip('/')}/rest/v1/barangays"
        "?select=barangay_id,barangay_name,municipality,province"
        "&order=barangay_name.asc"
    )

    req = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            details = json.loads(error_body)
        except json.JSONDecodeError:
            details = error_body
        return jsonify({
            "success": False,
            "message": "Failed to fetch barangays.",
            "details": details
        }), e.code
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 200:
        try:
            details = json.loads(response_body)
        except json.JSONDecodeError:
            details = response_body
        return jsonify({
            "success": False,
            "message": "Failed to fetch barangays.",
            "details": details
        }), status_code

    barangays = json.loads(response_body) if response_body else []

    return jsonify({
        "success": True,
        "data": barangays
    }), 200


@app.route("/api/get_posts", methods=["GET", "OPTIONS"])
def get_posts():
    if request.method == "OPTIONS":
        return "", 204

    # Optional: filter by a single post id, e.g. /api/get_posts?id=5
    post_id_raw = request.args.get("id")
    post_id = None
    if post_id_raw:
        try:
            post_id = int(post_id_raw)
        except ValueError:
            post_id = None

    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/rpc/get_website_post_details"
    body = json.dumps({"p_website_post_id": post_id}).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            details = json.loads(error_body)
        except json.JSONDecodeError:
            details = error_body
        return jsonify({
            "success": False,
            "message": "Supabase error.",
            "details": details
        }), e.code
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 200:
        try:
            details = json.loads(response_body)
        except json.JSONDecodeError:
            details = response_body
        return jsonify({
            "success": False,
            "message": "Supabase error.",
            "details": details
        }), status_code

    posts = json.loads(response_body) if response_body else []

    return jsonify({
        "success": True,
        "data": posts
    }), 200


@app.route("/api/post_comment", methods=["POST", "OPTIONS"])
def post_comment():
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}

    try:
        website_post_id = int(data.get("website_post_id") or 0)
    except (TypeError, ValueError):
        website_post_id = 0

    try:
        resident_id = int(data.get("resident_id") or 0)
    except (TypeError, ValueError):
        resident_id = 0

    content = (data.get("content") or "").strip()

    # ---- Validate ----
    if website_post_id <= 0:
        return jsonify({
            "success": False,
            "message": "Invalid post."
        }), 400

    if resident_id <= 0:
        return jsonify({
            "success": False,
            "message": "You must be logged in to comment."
        }), 401

    if not content:
        return jsonify({
            "success": False,
            "message": "Comment cannot be empty."
        }), 400

    # ---- Auto-flag negative/toxic comments for officials to review ----
    should_flag = is_comment_negative(content)

    # ---- Insert comment into Supabase ----
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/resident_comments"

    new_comment = {
        "website_post_id": website_post_id,
        "resident_id": resident_id,
        "content": content,
        "is_read": False,
        "is_flagged": should_flag,
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(new_comment).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=representation",
        },
    )

    try:
        with urllib.request.urlopen(req) as resp:
            status_code = resp.status
            response_body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        try:
            details = json.loads(error_body)
        except json.JSONDecodeError:
            details = error_body
        return jsonify({
            "success": False,
            "message": "Failed to post comment.",
            "details": details
        }), 500
    except urllib.error.URLError as e:
        return jsonify({
            "success": False,
            "message": f"Request failed: {e.reason}"
        }), 500

    if status_code != 201:
        try:
            details = json.loads(response_body)
        except json.JSONDecodeError:
            details = response_body
        return jsonify({
            "success": False,
            "message": "Failed to post comment.",
            "details": details
        }), 500

    comment = json.loads(response_body)

    return jsonify({
        "success": True,
        "message": "Comment posted successfully.",
        "comment": comment[0]
    }), 200


if __name__ == "__main__":
    app.run(debug=True)