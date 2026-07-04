import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router'; // 👈 IMPORTANTE: El motor de rutas
import { IonContent, IonInput, IonIcon, IonButton, AlertController } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth';
import { BiometricService } from '../services/biometric.service';
import { addIcons } from 'ionicons';
import { mailOutline, lockClosedOutline, flash, eyeOutline, eyeOffOutline, fingerPrintOutline, scanOutline } from 'ionicons/icons';
import { Keyboard } from '@capacitor/keyboard';
import { Capacitor } from '@capacitor/core';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrl: './login.page.scss',
  standalone: true,
  imports: [IonContent, IonInput, IonIcon, IonButton, FormsModule]
})
export class LoginPage implements OnInit, OnDestroy {
  email: string = '';
  password: string = '';
  showPassword: boolean = false;
  keyboardOpen: boolean = false;

  // Estado del login biométrico (Face ID / huella)
  biometricEnabled: boolean = false;   // hay credenciales guardadas y el hardware está disponible
  biometricLabel: string = 'Face ID';  // texto adaptado al dispositivo
  biometricIcon: string = 'scan-outline';

  // 👈 IMPORTANTE: Inyectamos el Router aquí
  constructor(
    private authService: AuthService,
    private biometricService: BiometricService,
    private router: Router,
    private ngZone: NgZone,
    private alertController: AlertController
  ) {
    addIcons({ mailOutline, lockClosedOutline, flash, eyeOutline, eyeOffOutline, fingerPrintOutline, scanOutline });
  }

  async ngOnInit() {
    if (Capacitor.isNativePlatform()) {
      Keyboard.addListener('keyboardWillShow', () => {
        this.ngZone.run(() => {
          this.keyboardOpen = true;
        });
      });

      Keyboard.addListener('keyboardDidHide', () => {
        this.ngZone.run(() => {
          this.keyboardOpen = false;
        });
      });
    }

    await this.checkBiometricState();
  }

  ngOnDestroy() {
    if (Capacitor.isNativePlatform()) {
      Keyboard.removeAllListeners();
    }
  }

  /** Determina si mostrar el botón de acceso biométrico y con qué texto/ícono. */
  private async checkBiometricState() {
    const available = await this.biometricService.isAvailable();
    const hasCreds = available && await this.biometricService.hasSavedCredentials();

    this.biometricLabel = await this.biometricService.getBiometryLabel();
    // Ícono: rostro (Face ID) vs huella
    this.biometricIcon = this.biometricLabel === 'huella' ? 'finger-print-outline' : 'scan-outline';

    this.ngZone.run(() => {
      this.biometricEnabled = hasCreds;
    });
  }

  onLogin() {
    if (this.email && this.password) {
      console.log('Disparando conexión real hacia Keycloak para:', this.email);

      this.authService.login(this.email, this.password).subscribe({
        next: async (response) => {
          console.log('¡Conexión Exitosa con Keycloak!', response);
          // Ofrecer activar el ingreso biométrico tras un login manual exitoso
          await this.offerBiometricEnrollment(this.email, this.password);
          // 👈 IMPORTANTE: Hacemos el teletransporte mágico al Dashboard
          this.router.navigate(['/home']);
        },
        error: (err) => {
          console.error('Error devuelto por Keycloak:', err);
          alert('Error de autenticación: Verifica tus credenciales o la configuración de CORS.');
        }
      });
    } else {
      alert('Por favor, ingresa tu correo y contraseña.');
    }
  }

  /** Login rápido: verifica identidad biométrica y usa las credenciales guardadas. */
  async loginWithBiometrics() {
    try {
      const credentials = await this.biometricService.authenticate();

      this.authService.login(credentials.username, credentials.password).subscribe({
        next: () => {
          this.ngZone.run(() => this.router.navigate(['/home']));
        },
        error: async (err) => {
          console.error('Error de autenticación con credenciales biométricas:', err);
          // Las credenciales guardadas ya no sirven (cambio de contraseña, etc.)
          await this.biometricService.clearCredentials();
          this.ngZone.run(() => (this.biometricEnabled = false));
          alert('Tus credenciales guardadas ya no son válidas. Inicia sesión con tu contraseña.');
        }
      });
    } catch (err) {
      // El usuario canceló o la verificación biométrica falló: no hacemos nada.
      console.log('Verificación biométrica cancelada o fallida:', err);
    }
  }

  /**
   * Tras un login manual exitoso, pregunta al usuario si desea activar el
   * ingreso biométrico. Solo aplica en dispositivos con hardware disponible
   * y cuando aún no hay credenciales guardadas.
   */
  private async offerBiometricEnrollment(email: string, password: string) {
    const available = await this.biometricService.isAvailable();
    if (!available) {
      return;
    }
    const alreadySaved = await this.biometricService.hasSavedCredentials();
    if (alreadySaved) {
      return;
    }

    const label = await this.biometricService.getBiometryLabel();
    const alert = await this.alertController.create({
      header: `Activar ingreso con ${label}`,
      message: `¿Quieres usar ${label} para ingresar más rápido la próxima vez?`,
      buttons: [
        {
          text: 'Ahora no',
          role: 'cancel'
        },
        {
          text: 'Activar',
          handler: async () => {
            try {
              await this.biometricService.saveCredentials(email, password);
              this.biometricEnabled = true;
            } catch (e) {
              console.error('No se pudieron guardar las credenciales biométricas:', e);
            }
          }
        }
      ]
    });

    await alert.present();
    // Esperar a que el usuario responda antes de navegar
    await alert.onDidDismiss();
  }
}
