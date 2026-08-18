import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * Servicio de notificaciones locales de alta prioridad.
 * Se usa para las alarmas de temperatura de Medición Inteligente cuando la app
 * está abierta o en segundo plano. (Para que suene con la app CERRADA se requiere
 * push desde el backend — ver documentación del módulo.)
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  /** Canal Android de alta importancia (heads-up + sonido + vibración). */
  private readonly CHANNEL_ID = 'temperatura-alarmas';
  private initialized = false;
  private permissionGranted = false;

  /** Solicita permisos y crea el canal de alta prioridad. Idempotente. */
  async init(): Promise<boolean> {
    if (!Capacitor.isNativePlatform()) return false;
    if (this.initialized) return this.permissionGranted;
    this.initialized = true;
    try {
      let perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        perm = await LocalNotifications.requestPermissions();
      }
      this.permissionGranted = perm.display === 'granted';
      if (!this.permissionGranted) return false;

      await LocalNotifications.createChannel({
        id: this.CHANNEL_ID,
        name: 'Alarmas de Temperatura',
        description: 'Alertas cuando la temperatura de un medidor sube más del 10%.',
        importance: 5,   // MAX → heads-up en pantalla
        visibility: 1,   // visible en pantalla de bloqueo
        sound: 'default',
        vibration: true,
        lights: true,
      });
      return true;
    } catch (e) {
      console.error('No se pudo inicializar notificaciones locales:', e);
      return false;
    }
  }

  /**
   * Dispara una notificación local de alta prioridad (heads-up + sonido + vibración).
   * @param id  identificador numérico único (32-bit) para la notificación.
   */
  async fireTemperatureAlarm(id: number, title: string, body: string): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      // En web no hay notificaciones nativas; se deja traza para depuración.
      console.log('🌡️ [web] Alarma de temperatura:', title, '—', body);
      return;
    }
    const ok = await this.init();
    if (!ok) return;
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id,
          channelId: this.CHANNEL_ID,
          title,
          body,
          schedule: { at: new Date(Date.now() + 150) },
          autoCancel: true,
          extra: { type: 'temperatura' },
        }],
      });
    } catch (e) {
      console.error('No se pudo emitir la notificación de temperatura:', e);
    }
  }
}
