/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Pose, Camera, drawConnectors, drawLandmarks, POSE_CONNECTIONS, Results } from './lib/mediapipe';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle, ShieldAlert, Languages, Play, Square, Volume2, User, Activity } from 'lucide-react';

// --- Constants & Types ---

type AppStatus = 'SAFE' | 'WARNING' | 'EMERGENCY';
type Language = 'EN' | 'TA';

const THRESHOLDS = {
  SWAY_VARIANCE: 0.005, // Threshold for X-axis variance
  POSTURE_LEAN: 30,     // Degrees
  RISK_DURATION: 3000,  // 5 seconds to trigger warning
  RECOVERY_WINDOW: 50, // 20 seconds for recovery
};

const UI_LABELS = {
  EN: {
    title: "Inclusive AI: Assistive Living",
    start: "Start Monitoring",
    stop: "Stop Monitoring",
    status: "Current Status",
    safe: "Safe",
    warning: "High Fall Risk",
    emergency: "EMERGENCY: CAREGIVER NOTIFIED",
    sway: "Sway Intensity",
    posture: "Posture Lean",
    recovery: "Recovery Time Remaining",
    alertMsg: "Please be careful, please sit down.",
    emergencyMsg: "EMERGENCY: CAREGIVER NOTIFIED",
    buzzer: "Buzzer Activated",
  },
  TA: {
    title: "உதவி வாழ்க்கைக்கான உள்ளடக்கிய AI",
    start: "கண்காணிப்பைத் தொடங்கு",
    stop: "கண்காணிப்பை நிறுத்து",
    status: "தற்போதைய நிலை",
    safe: "பாதுகாப்பானது",
    warning: "வீழ்ச்சி அபாயம் அதிகம்",
    emergency: "அவசரம்: பராமரிப்பாளருக்கு அறிவிக்கப்பட்டது",
    sway: "அசைவு தீவிரம்",
    posture: "தோரணை சாய்வு",
    recovery: "மீட்பு நேரம் மீதமுள்ளது",
    alertMsg: "தயவுசெய்து கவனமாக இருங்கள், தயவுசெய்து அமருங்கள்.",
    emergencyMsg: "அவசரம்: பராமரிப்பாளருக்கு அறிவிக்கப்பட்டது",
    buzzer: "பஸர் இயக்கப்பட்டது",
  }
};

// --- Helper Functions ---

const calculateDistance = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

const calculateAngle = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
  const dy = p2.y - p1.y;
  const dx = p2.x - p1.x;
  let theta = Math.atan2(dy, dx); // range (-PI, PI]
  theta *= 180 / Math.PI; // rads to degs
  return theta;
};

// --- Main Component ---

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [status, setStatus] = useState<AppStatus>('SAFE');
  const [lang, setLang] = useState<Language>('EN');
  const [sway, setSway] = useState(0);
  const [lean, setLean] = useState(0);
  const [recoveryTime, setRecoveryTime] = useState(0);
  const [linkSent, setLinkSent] = useState(false);

  // Refs for stable access in callbacks
  const statusRef = useRef<AppStatus>('SAFE');
  const langRef = useRef<Language>('EN');
  const isMonitoringRef = useRef(isMonitoring);

  // Sync refs with state
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { isMonitoringRef.current = isMonitoring; }, [isMonitoring]);

  // State for tracking logic
  const hipHistory = useRef<{ x: number, t: number }[]>([]);
  const riskStartTime = useRef<number | null>(null);
  const recoveryStartTime = useRef<number | null>(null);
  const lastSpeechTime = useRef<number>(0);
  const emergencyEmailSent = useRef(false);

  const sendNotification = async (type: 'START' | 'EMERGENCY') => {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
    } catch (error) {
      console.error("Notification Error:", error);
    }
  };

  const speak = useCallback((text: string) => {
    if (Date.now() - lastSpeechTime.current < 5000) return; // Rate limit speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langRef.current === 'EN' ? 'en-US' : 'ta-IN';
    window.speechSynthesis.speak(utterance);
    lastSpeechTime.current = Date.now();
  }, []);

  const onResults = useCallback((results: Results) => {
    if (!canvasRef.current || !videoRef.current || !isMonitoringRef.current) return;

    const canvasCtx = canvasRef.current.getContext('2d');
    if (!canvasCtx) return;

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    canvasCtx.drawImage(results.image, 0, 0, canvasRef.current.width, canvasRef.current.height);

    if (results.poseLandmarks) {
      drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, { color: '#00FF00', lineWidth: 4 });
      drawLandmarks(canvasCtx, results.poseLandmarks, { color: '#FF0000', lineWidth: 2 });

      // Tracking Logic
      const landmarks = results.poseLandmarks;
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftKnee = landmarks[25];
      const rightKnee = landmarks[26];
      const leftWrist = landmarks[15];
      const rightWrist = landmarks[16];
      const nose = landmarks[0];

      const midHip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
      const midShoulder = { x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2 };

      // 1. Calculate Sway (3s rolling window)
      const now = Date.now();
      hipHistory.current.push({ x: midHip.x, t: now });
      hipHistory.current = hipHistory.current.filter(h => now - h.t <= 3000);

      if (hipHistory.current.length > 10) {
        const xs = hipHistory.current.map(h => h.x);
        const mean = xs.reduce((a, b) => a + b) / xs.length;
        const variance = xs.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / xs.length;
        setSway(variance * 1000); // Scale for UI

        // 2. Calculate Posture Lean
        const angle = Math.abs(calculateAngle(midShoulder, midHip) - 90);
        setLean(angle);

        // --- Fall Risk Logic ---
        const currentStatus = statusRef.current;
        const currentLang = langRef.current;

        // Stage 1: Detection
        const isHighRisk = variance > THRESHOLDS.SWAY_VARIANCE || angle > THRESHOLDS.POSTURE_LEAN;

        if (currentStatus === 'SAFE') {
          if (isHighRisk) {
            if (!riskStartTime.current) riskStartTime.current = now;
            if (now - riskStartTime.current > THRESHOLDS.RISK_DURATION) {
              setStatus('WARNING');
              recoveryStartTime.current = now;
              speak(UI_LABELS[currentLang].alertMsg);
            }
          } else {
            riskStartTime.current = null;
          }
        }

        // Stage 3: Recovery
        if (currentStatus === 'WARNING') {
          const timeElapsed = now - (recoveryStartTime.current || now);
          const remaining = Math.max(0, Math.ceil((THRESHOLDS.RECOVERY_WINDOW - timeElapsed) / 1000));
          setRecoveryTime(remaining);

          // Condition to Stop Alert: Sat down or Hand Raise
          const satDown = midHip.y > leftKnee.y || midHip.y > rightKnee.y;
          const handRaised = leftWrist.y < nose.y || rightWrist.y < nose.y;

          if (satDown || handRaised) {
            setStatus('SAFE');
            riskStartTime.current = null;
            recoveryStartTime.current = null;
          } else if (timeElapsed > THRESHOLDS.RECOVERY_WINDOW) {
            // Stage 4: Emergency
            setStatus('EMERGENCY');
            if (!emergencyEmailSent.current) {
              sendNotification('EMERGENCY');
              emergencyEmailSent.current = true;
            }
            console.log("BUZZER_ACTIVATE_COMMAND");
            speak(UI_LABELS[currentLang].emergencyMsg);
          }
        }
      }
    }
    canvasCtx.restore();
  }, [speak]);

  useEffect(() => {
    let pose: Pose | null = null;
    let camera: Camera | null = null;
    let isEffectActive = true;

    if (isMonitoring && videoRef.current && canvasRef.current) {
      pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
      });

      pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      pose.onResults(onResults);

      camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (isEffectActive && pose && videoRef.current) {
            try {
              await pose.send({ image: videoRef.current });
            } catch (e) {
              console.error("Pose send error:", e);
            }
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }

    return () => {
      isEffectActive = false;
      camera?.stop();
      pose?.close();
    };
  }, [isMonitoring, onResults]);

  const toggleMonitoring = () => {
    if (isMonitoring) {
      setIsMonitoring(false);
      setStatus('SAFE');
      setSway(0);
      setLean(0);
      riskStartTime.current = null;
      recoveryStartTime.current = null;
      emergencyEmailSent.current = false;
    } else {
      setIsMonitoring(true);
      if (!linkSent) {
        sendNotification('START');
        setLinkSent(true);
      }
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'SAFE': return 'bg-emerald-500';
      case 'WARNING': return 'bg-amber-500';
      case 'EMERGENCY': return 'bg-rose-600';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'SAFE': return <CheckCircle className="w-8 h-8 text-white" />;
      case 'WARNING': return <AlertTriangle className="w-8 h-8 text-white" />;
      case 'EMERGENCY': return <ShieldAlert className="w-8 h-8 text-white" />;
    }
  };

  return (
    <div className="min-h-screen bg-neutral-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-neutral-200">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-100 rounded-xl">
              <Activity className="w-8 h-8 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-neutral-900">{UI_LABELS[lang].title}</h1>
              <p className="text-neutral-500 text-sm">Real-time Computer Vision Assistive System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 mt-4 md:mt-0">
            <button 
              onClick={() => setLang(lang === 'EN' ? 'TA' : 'EN')}
              className="flex items-center gap-2 px-4 py-2 bg-neutral-100 hover:bg-neutral-200 rounded-lg transition-colors font-medium"
            >
              <Languages className="w-4 h-4" />
              {lang === 'EN' ? 'தமிழ்' : 'English'}
            </button>
            
            <button
              onClick={toggleMonitoring}
              className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all ${
                isMonitoring 
                ? 'bg-rose-100 text-rose-600 hover:bg-rose-200' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'
              }`}
            >
              {isMonitoring ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              {isMonitoring ? UI_LABELS[lang].stop : UI_LABELS[lang].start}
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Video Feed */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative aspect-video bg-black rounded-2xl overflow-hidden shadow-xl border-4 border-white">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover opacity-0"
                playsInline
                muted
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover"
                width={640}
                height={480}
              />
              {!isMonitoring && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-900/80 text-white p-6 text-center">
                  <User className="w-16 h-16 mb-4 opacity-20" />
                  <p className="text-lg font-medium opacity-60">Camera feed is inactive. Click "Start Monitoring" to begin.</p>
                </div>
              )}
            </div>

            {/* Metrics Bar */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1">{UI_LABELS[lang].sway}</div>
                <div className="flex items-end gap-2">
                  <div className="text-2xl font-mono font-bold text-indigo-600">{sway.toFixed(2)}</div>
                  <div className="w-full bg-neutral-100 h-2 rounded-full mb-2 overflow-hidden">
                    <motion.div 
                      className="h-full bg-indigo-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, sway * 5)}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-neutral-200">
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-1">{UI_LABELS[lang].posture}</div>
                <div className="flex items-end gap-2">
                  <div className="text-2xl font-mono font-bold text-indigo-600">{lean.toFixed(1)}°</div>
                  <div className="w-full bg-neutral-100 h-2 rounded-full mb-2 overflow-hidden">
                    <motion.div 
                      className="h-full bg-indigo-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(100, (lean / 45) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Status Panel */}
          <div className="space-y-6">
            <div className={`status-box p-8 rounded-2xl shadow-lg text-white flex flex-col items-center text-center space-y-4 ${getStatusColor()}`}>
              <motion.div
                animate={status !== 'SAFE' ? { scale: [1, 1.1, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1 }}
              >
                {getStatusIcon()}
              </motion.div>
              <div>
                <h2 className="text-sm font-bold uppercase tracking-widest opacity-80">{UI_LABELS[lang].status}</h2>
                <p className="text-3xl font-black mt-1">
                  {status === 'SAFE' ? UI_LABELS[lang].safe : status === 'WARNING' ? UI_LABELS[lang].warning : UI_LABELS[lang].emergency}
                </p>
              </div>
              
              <AnimatePresence>
                {status === 'WARNING' && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-white/20 p-4 rounded-xl backdrop-blur-sm w-full"
                  >
                    <div className="text-xs font-bold uppercase mb-1">{UI_LABELS[lang].recovery}</div>
                    <div className="text-4xl font-mono font-black">{recoveryTime}s</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Instructions / Info */}
            <div className="bg-white p-6 rounded-2xl border border-neutral-200 space-y-4">
              <h3 className="font-bold text-neutral-900 flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-indigo-600" />
                System Logic
              </h3>
              <ul className="text-sm text-neutral-600 space-y-3">
                <li className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">1</div>
                  Detects excessive sway or leaning for 5 seconds.
                </li>
                <li className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">2</div>
                  Triggers voice warning and 50s recovery window.
                </li>
                <li className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-indigo-600">3</div>
                  Reset by sitting down or raising a hand.
                </li>
                <li className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-rose-50 flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-rose-600">4</div>
                  Emergency alert if no recovery within 50s.
                </li>
              </ul>
            </div>

            {/* Emergency Log */}
            {status === 'EMERGENCY' && (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-rose-50 border-2 border-rose-200 p-4 rounded-xl text-rose-700 text-center font-bold"
              >
                {UI_LABELS[lang].buzzer}!
              </motion.div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
