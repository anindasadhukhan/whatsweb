import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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
export const db = getDatabase(app);
