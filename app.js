import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, push, onValue, onChildAdded
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

// এখানে তোমার Firebase প্রজেক্টের Config বসাও
const firebaseConfig = {
  apiKey: "AIzaSyAZfaUMR_FZv0NSYargqKcxb_hGRo4NovA",
  authDomain: "whatsweb-a479d.firebaseapp.com",
  databaseURL: "https://whatsweb-a479d-default-rtdb.firebaseio.com",
  projectId: "whatsweb-a479d",
  storageBucket: "whatsweb-a479d.firebasestorage.app",
  messagingSenderId: "218335816115",
  appId: "1:218335816115:web:472b00bbeea084320b83c6"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// State
let currentUser = null;
let activePartner = null;
let unsubscribeMessages = null;
let unsubscribeChatList = null;
let uploadedPhotoBase64 = "";

// DOM Elements
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authError = document.getElementById("auth-error");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

// Helper: SHA-256 Password Hashing
async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: Compress Profile Image to Base64 (120x120)
function compressImage(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const size = 120;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function defaultAvatar(uid) {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(uid)}&background=FF7A00&color=fff`;
}

// Auth Tab Switching
document.getElementById("tab-login").onclick = () => {
  document.getElementById("tab-login").classList.add("active");
  document.getElementById("tab-signup").classList.remove("active");
  loginForm.classList.remove("hidden");
  signupForm.classList.add("hidden");
  authError.textContent = "";
};

document.getElementById("tab-signup").onclick = () => {
  document.getElementById("tab-signup").classList.add("active");
  document.getElementById("tab-login").classList.remove("active");
  signupForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  authError.textContent = "";
};

// Profile Photo Preview
document.getElementById("signup-photo").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  uploadedPhotoBase64 = await compressImage(file);
  document.getElementById("avatar-preview").src = uploadedPhotoBase64;
});

// Sign Up Handler
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";

  const uid = document.getElementById("signup-uid").value.trim().toLowerCase();
  const mobile = document.getElementById("signup-mobile").value.replace(/\D/g, "");
  const password = document.getElementById("signup-password").value;

  if (!/^[a-z0-9_]{3,20}$/.test(uid)) {
    authError.textContent = "User ID must be 3-20 chars (letters, numbers, _ only).";
    return;
  }
  if (mobile.length < 10) {
    authError.textContent = "Enter a valid mobile number (at least 10 digits).";
    return;
  }
  if (password.length < 6) {
    authError.textContent = "Password must be at least 6 characters.";
    return;
  }

  const [uidSnap, mobileSnap] = await Promise.all([
    get(ref(db, `users/${uid}`)),
    get(ref(db, `mobile_lookup/${mobile}`))
  ]);

  if (uidSnap.exists()) {
    authError.textContent = "This User ID is already taken.";
    return;
  }
  if (mobileSnap.exists()) {
    authError.textContent = "This Mobile Number is already registered.";
    return;
  }

  const userData = {
    userId: uid,
    mobile: mobile,
    passwordHash: await hashPassword(password),
    photo: uploadedPhotoBase64 || defaultAvatar(uid),
    createdAt: Date.now()
  };

  await set(ref(db, `users/${uid}`), userData);
  await set(ref(db, `mobile_lookup/${mobile}`), uid);

  loginSuccess(userData);
});

// Login Handler
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";

  const identifier = document.getElementById("login-identifier").value.trim().toLowerCase();
  const password = document.getElementById("login-password").value;

  let targetUid = identifier;
  if (/^\d+$/.test(identifier)) {
    const mobileSnap = await get(ref(db, `mobile_lookup/${identifier}`));
    if (!mobileSnap.exists()) {
      authError.textContent = "Account not found.";
      return;
    }
    targetUid = mobileSnap.val();
  }

  const userSnap = await get(ref(db, `users/${targetUid}`));
  if (!userSnap.exists()) {
    authError.textContent = "Account not found.";
    return;
  }

  const userData = userSnap.val();
  if (userData.passwordHash !== (await hashPassword(password))) {
    authError.textContent = "Incorrect password.";
    return;
  }

  loginSuccess(userData);
});

function loginSuccess(userData) {
  currentUser = userData;
  localStorage.setItem("whatsweb_uid", userData.userId);
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  document.getElementById("my-uid").textContent = userData.userId;
  document.getElementById("my-avatar").src = userData.photo || defaultAvatar(userData.userId);
  loadChatList();
}

// Logout
document.getElementById("btn-logout").onclick = () => {
  localStorage.removeItem("whatsweb_uid");
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeChatList) unsubscribeChatList();
  location.reload();
};

// Load User's Chat List (Real-time)
function loadChatList() {
  const listEl = document.getElementById("chat-list");
  unsubscribeChatList = onValue(ref(db, `user_chats/${currentUser.userId}`), async (snapshot) => {
    const data = snapshot.val();
    if (!data) {
      listEl.innerHTML = `<p class="empty-hint">No chats yet. Click <strong>+</strong> to start messaging.</p>`;
      return;
    }

    const partners = Object.entries(data).sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
    listEl.innerHTML = "";

    for (const [partnerId, meta] of partners) {
      const pSnap = await get(ref(db, `users/${partnerId}`));
      const pData = pSnap.exists() ? pSnap.val() : { userId: partnerId, photo: defaultAvatar(partnerId), mobile: "" };

      const item = document.createElement("div");
      item.className = "chat-item" + (activePartner?.userId === partnerId ? " active" : "");

      const img = document.createElement("img");
      img.src = pData.photo || defaultAvatar(partnerId);

      const info = document.createElement("div");
      info.className = "chat-item-info";

      const title = document.createElement("h4");
      title.textContent = pData.userId;

      const lastMsg = document.createElement("p");
      lastMsg.textContent = meta.lastMessage || "Start chatting...";

      info.append(title, lastMsg);
      item.append(img, info);
      item.onclick = () => openChat(pData);
      listEl.appendChild(item);
    }
  });
}

// Open Chat Room & Load Message History + Real-Time Updates
function openChat(partnerData) {
  activePartner = partnerData;
  document.getElementById("no-chat-selected").classList.add("hidden");
  document.getElementById("active-chat").classList.remove("hidden");
  appScreen.classList.add("mobile-chat-open");

  document.getElementById("partner-uid").textContent = partnerData.userId;
  document.getElementById("partner-mobile").textContent = partnerData.mobile || "";
  document.getElementById("partner-avatar").src = partnerData.photo || defaultAvatar(partnerData.userId);

  const messagesBox = document.getElementById("messages-box");
  messagesBox.innerHTML = "";

  if (unsubscribeMessages) unsubscribeMessages();

  const roomId = [currentUser.userId, partnerData.userId].sort().join("_");
  unsubscribeMessages = onChildAdded(ref(db, `chats/${roomId}`), (snap) => {
    const msg = snap.val();
    const div = document.createElement("div");
    div.className = "msg " + (msg.sender === currentUser.userId ? "sent" : "received");

    const textNode = document.createElement("span");
    textNode.textContent = msg.text;

    const timeNode = document.createElement("span");
    timeNode.className = "msg-time";
    timeNode.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    div.append(textNode, timeNode);
    messagesBox.appendChild(div);
    messagesBox.scrollTop = messagesBox.scrollHeight;
  });
}

// Send Message
document.getElementById("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activePartner) return;

  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;

  const roomId = [currentUser.userId, activePartner.userId].sort().join("_");
  const now = Date.now();

  await push(ref(db, `chats/${roomId}`), {
    sender: currentUser.userId,
    text: text,
    timestamp: now
  });

  await set(ref(db, `user_chats/${currentUser.userId}/${activePartner.userId}`), {
    lastMessage: text,
    timestamp: now
  });
  await set(ref(db, `user_chats/${activePartner.userId}/${currentUser.userId}`), {
    lastMessage: text,
    timestamp: now
  });

  input.value = "";
});

// Mobile Back Button
document.getElementById("btn-back").onclick = () => {
  appScreen.classList.remove("mobile-chat-open");
};

// New Chat Modal
const modal = document.getElementById("new-chat-modal");
const searchInput = document.getElementById("search-user-input");
const searchError = document.getElementById("search-error");

document.getElementById("btn-new-chat").onclick = () => {
  modal.classList.remove("hidden");
  searchInput.value = "";
  searchError.textContent = "";
  searchInput.focus();
};

document.getElementById("btn-cancel-modal").onclick = () => modal.classList.add("hidden");

document.getElementById("btn-start-chat").onclick = async () => {
  searchError.textContent = "";
  const query = searchInput.value.trim().toLowerCase();
  if (!query) return;

  let targetUid = query;
  if (/^\d+$/.test(query)) {
    const mSnap = await get(ref(db, `mobile_lookup/${query}`));
    if (!mSnap.exists()) {
      searchError.textContent = "No user found with this mobile number.";
      return;
    }
    targetUid = mSnap.val();
  }

  if (targetUid === currentUser.userId) {
    searchError.textContent = "You cannot start a chat with yourself.";
    return;
  }

  const uSnap = await get(ref(db, `users/${targetUid}`));
  if (!uSnap.exists()) {
    searchError.textContent = "User not found.";
    return;
  }

  modal.classList.add("hidden");
  openChat(uSnap.val());
};

// Auto-Login on Page Refresh
(async function initSession() {
  const savedUid = localStorage.getItem("whatsweb_uid");
  if (!savedUid) return;
  const snap = await get(ref(db, `users/${savedUid}`));
  if (snap.exists()) loginSuccess(snap.val());
})();