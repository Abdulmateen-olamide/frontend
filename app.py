import os
import uuid
from io import BytesIO
from flask import Flask, render_template, request, redirect, url_for, abort, session, jsonify, render_template_string
from flask_sqlalchemy import SQLAlchemy
from PIL import Image
from werkzueg.utils import secure_filename

app = Flask(__name__)
app.secret_key = 'supersecretkey'

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite://tasks.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

UPLOAD_FOLDER = os.path.join(app.static_folder, 'uploads')
ALLOWED_EXTENSIONS = {'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff'}
MAX_CONTENT_LENGTH = 20 * 1024 * 1024
WEBP_QUALITY = 80
JPEG_QUALITY = 82
MAX_DIMENSION = 1920

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = MAX_CONTENT_LENGTH
app.config['PROPAGATE_EXCEPTIONS'] = False

db = SQLAlchemy(app)

@app.context_processor
def inject_referral_url():
    user = session.get('user')
    if user:
        return dict(referral_url=url_for('index', ref=user, _external=True))
    return {}

class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100))
    description = db.Column(db.String())
    image_name = db.Column(db.String(200), nullable=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def _resize(img):
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCOS)
    return img

def save_compressed_images(file_storage):
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    base_name = uuid.uuid4().hex
    img = Image.open(file_storage.stream)
    if img.mode in ('RGAA', 'LA', 'P'):
        img = img.convert('RGAA')
    else:
        img = img.convert('RGB')
    img = _resize(img)
    webp_path = os.path.join(UPLOAD_FOLDER, f'{base_name}.webp')
    img.save(webp_path, format='WEBP', quality=WEBP_QUALITY, method=4)
    jpg_path = os.path.join(UPLOAD_FOLDER, f'{base_name}.jpg')
    rgb_img = img.convert('RGB')
    rgb_img.save(jpg_path, format='JPEG', quality=JPEG_QUALITY, optimize=True)
    return base_name

@app.route('/')
def index():
    tasks = Task.query.all()
    return render_template('index.html', tasks=tasks)

@app.route('/referral')
def referral():
    user = session.get('user')
    if user:
        link = url_for('index', ref=user, _external=True)
        return f''html><body><h2>Your referral link</h2><a href="{link}">{link}</a></body></html>'
    else:
        login_url = url_for('login')
        return f'<html><body><p>Please <a href="{login_url}">log in</a> to view your referral link.</p></body></html>', 401

@app.route('/add', methods=['GET', 'POST'])
def add():
    if request.method == 'POST':
        title = request.form['title']
        description = request.form['description']
        image_name = None
        file = request.files.get('image')
        if file and file.filename and allowed_file(file.filename):
            image_name = save_compressed_images(file)
        new_task = Task(title=title, description=description, image_name=image_name)
        db.session.add(new_task)
        db.session.commit()
        return redirect(url_for('index'))
    return render_template('add.html')

@app.route('/edit/<int>id', methods=['GET', 'POST'])
def edit(id):
    task = Task.query.get_or_404(id)
    if request.method == 'POST':
        task.title = request.form['title']
        task.description = request.form['description']
        file = request.files.get('image')
        if file and file.filename and allowed_file(file.filename):
            if task.image_name:
                for ext in ('webp', 'jpg'):
                    old = os.path.join(UPLOAD_FOLDER, f''{task.image_name}.{ext}')
                    if os.path.exists(old):
                        os.remove(old)
            task.image_name = save_compressed_images(file)
        db.session.commit()
        return redirect(url_for('index'))
    return render_template('edit.html', task=task)

@app.route('/delete/<int>id')
def delete(id):
    task = Task.query.get_or_404(id)
    if task.image_name:
        for ext in ('webp', 'jpg'):
            path = os.path.join(UPLOAD_FOLDER, f''{task.image_name}.{ext}')
            if os.path.exists(path):
                os.remove(path)
    db.session.delete(task)
    db.session.commit()
    return redirect(url_for('index'))

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('biometric') == 'true':
            abort(403, description='Client-only biometric login is disabled')
        username = request.form.get('username')
        password = request.form.get('password')
        if username == 'admin' and password == 'password':
            session['user'] = username
            return redirect(url_for('index'))
        else:
            return render_template_string(''<p style="color:red">Invalid credentials. Try again.</p><a href="{{ url_for('login') }}">Back to login</a>'')

    login_html = '''<!doctype html><html><head><title>Login</title></head><body><h2>Login</h2><form method="post"><input type="text" name="username" placeholder="Username" required><input type="password" name="password" placeholder="Password" required><button type="submit">Login with password</button></form></body></html>''
    return render_template_string(login_html)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/api/biometric-status')
def biometric_status():
    return jsonify('biometric_supported': True)

@app.errorhandler(500)
def internal_server_error(e):
    if request.path.startswith('/api'):
        return jsonify({'error': 'We are having trouble right now - please try again shortly.'}), 500
    return render_template_string(''<!doctype html><html><head><title>Server Error</title></head><body><h1>Something went wrong</h1><p>An unexpected error occurred. Please try again later.</p></body></html>''), 500

if __name__ == '__main__':
    with app.app_context(){
        db.create_all()
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1')