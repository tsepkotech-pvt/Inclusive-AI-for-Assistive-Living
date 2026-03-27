import cv2
import mediapipe as mp
import time
import math
import smtplib
import threading
from email.mime.text import MIMEText
from flask import Flask, render_template, Response, jsonify

app = Flask(__name__)

# --- MediaPipe Configuration ---
mp_pose = mp.solutions.pose
pose = mp_pose.Pose(
    static_image_mode=False,
    model_complexity=1,
    smooth_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)
mp_drawing = mp.solutions.drawing_utils

# --- Global State Variables ---
current_status = "STATUS: SAFE"
fall_start_time = None
alert_sent = False

# --- Email Configuration (PLACEHOLDERS) ---
SENDER_EMAIL = "YOUR_GMAIL@gmail.com"
APP_PASSWORD = "YOUR_APP_PASSWORD"  # 16-digit app password from Google
RECEIVER_EMAIL = "CAREGIVER_EMAIL@gmail.com"
DASHBOARD_LINK = "http://127.0.0.1:5000"

def send_email_async():
    """Sends the emergency email in a background thread to prevent lag."""
    global alert_sent
    try:
        msg = MIMEText(f"URGENT ALERT: Fall detected! View live feed here: {DASHBOARD_LINK}")
        msg['Subject'] = 'URGENT ALERT: Fall Detected!'
        msg['From'] = SENDER_EMAIL
        msg['To'] = RECEIVER_EMAIL

        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(SENDER_EMAIL, APP_PASSWORD)
            server.sendmail(SENDER_EMAIL, RECEIVER_EMAIL, msg.as_string())
        
        print("Emergency alert email sent successfully.")
    except Exception as e:
        print(f"Failed to send email: {e}")

def calculate_angle(p1, p2):
    """Calculates the angle of the line between two points relative to the horizontal."""
    dx = p2.x - p1.x
    dy = p2.y - p1.y
    angle = math.degrees(math.atan2(dy, dx))
    return abs(angle)

def gen_frames():
    global current_status, fall_start_time, alert_sent
    
    # Use 0 for local webcam
    cap = cv2.VideoCapture(0)
    
    while True:
        success, frame = cap.read()
        if not success:
            break
        
        # Optimize: Resize for faster processing
        frame = cv2.resize(frame, (640, 480))
        
        # Convert to RGB for MediaPipe
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(rgb_frame)
        
        if results.pose_landmarks:
            landmarks = results.pose_landmarks.landmark
            
            # Get Shoulder and Hip landmarks
            l_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
            r_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
            l_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP]
            r_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP]
            
            # Midpoints
            mid_shoulder = type('Point', (object,), {'x': (l_shoulder.x + r_shoulder.x)/2, 'y': (l_shoulder.y + r_shoulder.y)/2})
            mid_hip = type('Point', (object,), {'x': (l_hip.x + r_hip.x)/2, 'y': (l_hip.y + r_hip.y)/2})
            
            # Calculate angle with horizontal
            angle = calculate_angle(mid_shoulder, mid_hip)
            
            # Detection Logic: Horizontal position (Fall)
            # Upright is ~90. Horizontal is < 35 or > 145.
            is_horizontal = angle < 35 or angle > 145
            
            if is_horizontal:
                if fall_start_time is None:
                    fall_start_time = time.time()
                
                elapsed = time.time() - fall_start_time
                
                # Ultra-Fast Response Logic:
                # 1s: Trigger 'NOT SAFE - RISK' and send email
                if elapsed >= 1.0:
                    current_status = "NOT SAFE - RISK"
                    if not alert_sent:
                        alert_sent = True
                        threading.Thread(target=send_email_async).start()
            else:
                # Reset if they stand up (Recovery)
                fall_start_time = None
                if current_status != "STATUS: SAFE":
                    current_status = "STATUS: SAFE"
                    alert_sent = False # Reset flag for next event

            # Draw skeleton for visual feedback
            mp_drawing.draw_landmarks(frame, results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

        # Encode and yield
        ret, buffer = cv2.imencode('.jpg', frame)
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(gen_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/status')
def get_status():
    return jsonify(status=current_status)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
