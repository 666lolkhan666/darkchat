export const MAX_NAME_LENGTH = 100;
export const MAX_MESSAGE_LENGTH = 2000;

export function cleanMessage(name, text) {
  if (typeof name !== "string" || typeof text !== "string") {
    throw new Error("Enter a name and a message.");
  }

  const cleanName = name.trim();
  const cleanText = text.trim();
  if (!cleanName || !cleanText) {
    throw new Error("Enter a name and a message.");
  }
  if (cleanName.length > MAX_NAME_LENGTH) {
    throw new Error(`Names cannot be longer than ${MAX_NAME_LENGTH} characters.`);
  }
  if (cleanText.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`Messages cannot be longer than ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return { name: cleanName, text: cleanText };
}
