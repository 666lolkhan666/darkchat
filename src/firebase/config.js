export const firebaseConfig = {
  apiKey: "AIzaSyDV6ijhrHfKihPmYhmmghKwUpjMSf3sdbk",
  authDomain: "dark-chat-ff61d.firebaseapp.com",
  projectId: "dark-chat-ff61d",
  messagingSenderId: "284800870037",
  appId: "1:284800870037:web:6e05a14fc40ac49a615d9c"
};

export const ownerEmail = "ooismailforajioo@gmail.com";
export const ownerUid = "5Uc5gT6JclWsAE6fLouHV8TRsVe2";

export const isFirebaseConfigured = () =>
  Object.values(firebaseConfig).every(
    (value) => value && !value.startsWith("YOUR_")
  );

export const isOwnerConfigured = () =>
  ownerEmail &&
  !ownerEmail.startsWith("OWNER_") &&
  ownerUid &&
  !ownerUid.startsWith("OWNER_");
