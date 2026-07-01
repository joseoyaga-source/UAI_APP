import { Component, OnInit, OnDestroy, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router'; // 👈 IMPORTANTE: El motor de rutas
import { IonContent, IonInput, IonIcon, IonButton } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth'; 
import { addIcons } from 'ionicons';
import { mailOutline, lockClosedOutline, flash, eyeOutline, eyeOffOutline } from 'ionicons/icons';
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

  // 👈 IMPORTANTE: Inyectamos el Router aquí
  constructor(private authService: AuthService, private router: Router, private ngZone: NgZone) {
    addIcons({ mailOutline, lockClosedOutline, flash, eyeOutline, eyeOffOutline });
  }

  ngOnInit() {
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
  }

  ngOnDestroy() {
    if (Capacitor.isNativePlatform()) {
      Keyboard.removeAllListeners();
    }
  }

  onLogin() {
    if (this.email && this.password) {
      console.log('Disparando conexión real hacia Keycloak para:', this.email);
      
      this.authService.login(this.email, this.password).subscribe({
        next: (response) => {
          console.log('¡Conexión Exitosa con Keycloak!', response);
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
}
