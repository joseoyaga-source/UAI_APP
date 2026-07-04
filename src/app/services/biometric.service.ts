import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { NativeBiometric, BiometryType } from '@capgo/capacitor-native-biometric';

export interface StoredCredentials {
  username: string;
  password: string;
}

/**
 * Envuelve el plugin @capgo/capacitor-native-biometric para ofrecer
 * login rápido con Face ID / Touch ID (iOS) y huella / rostro (Android).
 *
 * Las credenciales se guardan en el almacenamiento seguro del sistema
 * (Keychain en iOS, almacenamiento cifrado con biometría en Android),
 * nunca en localStorage.
 */
@Injectable({
  providedIn: 'root'
})
export class BiometricService {
  // Identificador (dominio) bajo el cual se guardan las credenciales en el llavero.
  private readonly server = 'uaienergy.com';

  /**
   * Indica si el dispositivo tiene hardware biométrico disponible y configurado.
   * En navegador/web siempre devuelve false.
   */
  async isAvailable(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }
    try {
      const result = await NativeBiometric.isAvailable({ useFallback: true });
      return result.isAvailable;
    } catch {
      return false;
    }
  }

  /**
   * Devuelve el tipo de biometría del dispositivo para adaptar los textos
   * de la interfaz (p. ej. "Face ID" vs "Huella").
   */
  async getBiometryType(): Promise<BiometryType> {
    if (!Capacitor.isNativePlatform()) {
      return BiometryType.NONE;
    }
    try {
      const result = await NativeBiometric.isAvailable({ useFallback: true });
      return result.biometryType;
    } catch {
      return BiometryType.NONE;
    }
  }

  /** Texto legible del método biométrico para mostrar en la UI. */
  async getBiometryLabel(): Promise<string> {
    const type = await this.getBiometryType();
    switch (type) {
      case BiometryType.FACE_ID:
      case BiometryType.FACE_AUTHENTICATION:
        return 'Face ID';
      case BiometryType.TOUCH_ID:
      case BiometryType.FINGERPRINT:
        return 'huella';
      case BiometryType.IRIS_AUTHENTICATION:
        return 'iris';
      default:
        return 'biometría';
    }
  }

  /** True si ya hay credenciales guardadas para el login biométrico. */
  async hasSavedCredentials(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) {
      return false;
    }
    try {
      const creds = await NativeBiometric.getCredentials({ server: this.server });
      return !!creds && !!creds.username && !!creds.password;
    } catch {
      return false;
    }
  }

  /** Guarda las credenciales en el almacenamiento seguro del sistema. */
  async saveCredentials(username: string, password: string): Promise<void> {
    await NativeBiometric.setCredentials({
      username,
      password,
      server: this.server
    });
  }

  /**
   * Solicita la verificación biométrica al usuario y, si es correcta,
   * devuelve las credenciales guardadas. Lanza error si el usuario
   * cancela o la verificación falla.
   */
  async authenticate(): Promise<StoredCredentials> {
    await NativeBiometric.verifyIdentity({
      reason: 'Ingresa a UAI de forma rápida y segura',
      title: 'Autenticación UAI',
      subtitle: 'Confirma tu identidad',
      description: '',
      useFallback: true
    });

    const credentials = await NativeBiometric.getCredentials({ server: this.server });
    return { username: credentials.username, password: credentials.password };
  }

  /** Elimina las credenciales guardadas (p. ej. al cerrar sesión). */
  async clearCredentials(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      await NativeBiometric.deleteCredentials({ server: this.server });
    } catch {
      // Sin credenciales que borrar: nada que hacer.
    }
  }
}
