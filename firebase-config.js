// ============ Firebase ============
const firebaseConfig = {
  apiKey: "AIzaSyDGzNEJG6EYW2wvk7k2jS9xELErYyZHglg",
  authDomain: "alamirat-79e36.firebaseapp.com",
  projectId: "alamirat-79e36",
  storageBucket: "alamirat-79e36.firebasestorage.app",
  messagingSenderId: "245597111524",
  appId: "1:245597111524:web:f1481bb4c6e458e57018f1",
  measurementId: "G-3EJXDVD1PB"
};

// ============ Cloudinary ============
const cloudinaryConfig = {
  cloudName:    "exwka575",
  uploadPreset: "clothing_store_preset",
  folder:       "products"
};

const storeConfig = {
  currency: "ج.م",
  logoUrl: "logo.png", // ← اسم صورة اللوجو التي سترفعها
  storeName: "الأَمِيرَاتُ", // ← اسم المتجر
  phonePattern: /^01[0125][0-9]{8}$/,
  governorates: ["المنيا"], // المنيا فقط كافتراضي
  minyaCities: [
    "المنيا", "المنيا الجديدة", "العدوة", "مغاغة", "بني مزار", "مطاي", 
    "سمالوط", "أبو قرقاص", "ملوي", "دير مواس", "المنيا - أبو فليو", 
    "المنيا - تلة", "المنيا - البرجاية", "المنيا - ناصر", 
    "المنيا - المنصورة", "المنيا - بني عبيد"
  ]
};

// ============ Imports ============
import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const functions = getFunctions(app, "us-central1");

export {
  app, auth, db, functions,
  firebaseConfig, cloudinaryConfig, storeConfig
};