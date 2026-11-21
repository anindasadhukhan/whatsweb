import { ref, set, get, push, onValue, onChildAdded } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { db } from "./firebase-config.js";
import { compressAvatar, compressChatPhoto, readMediaFile, formatFileSize } from "./media.js";

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
const uploadStatus = document.getElementById("upload-status");
const lightboxModal = document.getElementById("lightbox-modal");
const lightboxImg = document.getElementById("lightbox-img");

// Helper: SHA-256 Password Hashing
async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
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
  try {
    uploadedPhotoBase64 = await compressAvatar(file);
    document.getElementById("avatar-preview").src = uploadedPhotoBase64;
  } catch (err) {
    authError.textContent = err.message;
  }
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
    mobile,
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
      listEl.innerHTML = `<p class="empty-hint">No chats yet. Tap <strong>+</strong> to start messaging.</p>`;
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

// Render Message Bubble (Text, Photo, Video, or Document)
function renderMessage(msg, messagesBox) {
  const div = document.createElement("div");
  div.className = "msg " + (msg.sender === currentUser.userId ? "sent" : "received");

  const type = msg.type || "text";

  if (type === "image" && msg.fileData) {
    const img = document.createElement("img");
    img.src = msg.fileData;
    img.className = "msg-photo";
    img.alt = msg.fileName || "Photo";
    img.onclick = () => {
      lightboxImg.src = msg.fileData;
      lightboxModal.classList.remove("hidden");
    };
    div.appendChild(img);
  } else if (type === "video" && msg.fileData) {
    const video = document.createElement("video");
    video.src = msg.fileData;
    video.className = "msg-video";
    video.controls = true;
    video.playsInline = true;
    div.appendChild(video);
  } else if (type === "document" && msg.fileData) {
    const link = document.createElement("a");
    link.href = msg.fileData;
    link.download = msg.fileName || "document";
    link.className = "msg-doc";

    const icon = document.createElement("div");
    icon.className = "doc-icon";
    icon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;

    const meta = document.createElement("div");
    meta.className = "doc-meta";

    const name = document.createElement("div");
    name.className = "doc-name";
    name.textContent = msg.fileName || "Document";

    const size = document.createElement("div");
    size.className = "doc-size";
    size.textContent = msg.fileSize ? `${msg.fileSize} • Tap to download` : "Tap to download";

    meta.append(name, size);
    link.append(icon, meta);
    div.appendChild(link);
  } else {
    const textNode = document.createElement("span");
    textNode.textContent = msg.text || "";
    div.appendChild(textNode);
  }

  const timeNode = document.createElement("span");
  timeNode.className = "msg-time";
  timeNode.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  div.appendChild(timeNode);
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
}

// Open Chat Room
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
    renderMessage(snap.val(), messagesBox);
  });
}

// Core Send Helper (supports text & media)
async function pushMessage(payload, previewLabel) {
  if (!activePartner) return;
  const roomId = [currentUser.userId, activePartner.userId].sort().join("_");
  const now = Date.now();

  await push(ref(db, `chats/${roomId}`), {
    sender: currentUser.userId,
    timestamp: now,
    ...payload
  });

  await Promise.all([
    set(ref(db, `user_chats/${currentUser.userId}/${activePartner.userId}`), {
      lastMessage: previewLabel,
      timestamp: now
    }),
    set(ref(db, `user_chats/${activePartner.userId}/${currentUser.userId}`), {
      lastMessage: previewLabel,
      timestamp: now
    })
  ]);
}

// Send Text Message
document.getElementById("message-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("message-input");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await pushMessage({ type: "text", text }, text);
});

// Wire up the 3 Media Icon Buttons
const inputPhoto = document.getElementById("input-photo");
const inputVideo = document.getElementById("input-video");
const inputDoc = document.getElementById("input-doc");

document.getElementById("btn-photo").onclick = () => inputPhoto.click();
document.getElementById("btn-video").onclick = () => inputVideo.click();
document.getElementById("btn-doc").onclick = () => inputDoc.click();

async function handleMediaUpload(file, type) {
  if (!file || !activePartner) return;
  uploadStatus.textContent = `Sending ${type}...`;
  uploadStatus.classList.remove("hidden");

  try {
    let fileData;
    if (type === "image") {
      fileData = await compressChatPhoto(file);
    } else {
      fileData = await readMediaFile(file);
    }

    const previewMap = {
      image: "📷 Photo",
      video: "🎥 Video",
      document: `📄 ${file.name}`
    };

    await pushMessage(
      {
        type,
        fileData,
        fileName: file.name,
        fileSize: formatFileSize(file.size)
      },
      previewMap[type]
    );
  } catch (err) {
    alert(err.message);
  } finally {
    uploadStatus.classList.add("hidden");
  }
}

inputPhoto.onchange = (e) => {
  handleMediaUpload(e.target.files[0], "image");
  e.target.value = "";
};
inputVideo.onchange = (e) => {
  handleMediaUpload(e.target.files[0], "video");
  e.target.value = "";
};
inputDoc.onchange = (e) => {
  handleMediaUpload(e.target.files[0], "document");
  e.target.value = "";
};

// Close Lightbox on click
lightboxModal.onclick = () => lightboxModal.classList.add("hidden");

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
