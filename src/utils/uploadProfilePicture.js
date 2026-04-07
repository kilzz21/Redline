import * as ImageManipulator from 'expo-image-manipulator';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../config/firebase';

/**
 * Resize, compress, and upload a profile picture to Firebase Storage.
 * @param {string} uid - Firebase user UID
 * @param {string} localUri - Local file URI from ImagePicker
 * @returns {Promise<string>} - Download URL of the uploaded image
 */
export async function uploadProfilePicture(uid, localUri) {
  const manipResult = await ImageManipulator.manipulateAsync(
    localUri,
    [{ resize: { width: 400 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );

  const response = await fetch(manipResult.uri);
  const blob = await response.blob();

  const storageRef = ref(storage, `profilePictures/${uid}.jpg`);
  await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });

  return getDownloadURL(storageRef);
}
