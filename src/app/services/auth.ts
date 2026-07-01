import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private tokenUrl = environment.authUrl;
  private clientId = environment.clientId;

  constructor(private http: HttpClient) { }

  login(email: string, password: string): Observable<any> {
    const payload = new HttpParams()
      .set('grant_type', 'password')
      .set('client_id', this.clientId)
      .set('username', email)
      .set('password', password)
      .set('scope', 'openid');

    const headers = new HttpHeaders({
      'Content-Type': 'application/x-www-form-urlencoded'
    });

    return new Observable<any>(observer => {
      this.http.post<any>(this.tokenUrl, payload.toString(), { headers }).subscribe({
        next: (response) => {
          if (response.access_token) {
            localStorage.setItem('auth_token', response.access_token);
            localStorage.setItem('refresh_token', response.refresh_token || '');
            if (response.id_token) {
              localStorage.setItem('id_token', response.id_token);
            }
            localStorage.setItem('user_data', JSON.stringify({
              email: email,
              login_time: new Date().toISOString()
            }));
          }
          observer.next(response);
          observer.complete();
        },
        error: (err) => {
          observer.error(err);
        }
      });
    });
  }

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  }

  getIdToken(): string | null {
    return localStorage.getItem('id_token');
  }

  getCompany(): string {
    // 1. Intentar con Access Token
    let company = this.getCompanyFromToken(this.getToken(), 'Access Token');
    // 2. Intentar con ID Token (muy común para claims de perfil del usuario en Keycloak)
    if (!company) {
      company = this.getCompanyFromToken(this.getIdToken(), 'ID Token');
    }
    return company;
  }

  getGivenName(): string {
    let name = this.getGivenNameFromToken(this.getToken(), 'Access Token');
    if (!name) {
      name = this.getGivenNameFromToken(this.getIdToken(), 'ID Token');
    }
    return name || 'Usuario';
  }

  private getGivenNameFromToken(token: string | null, tokenType: string): string {
    if (!token) return '';
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const decoded = JSON.parse(jsonPayload);
      
      const givenName = decoded.given_name || decoded.givenName || decoded.name || decoded.preferred_username;
      return givenName ? String(givenName).trim() : '';
    } catch (e) {
      return '';
    }
  }

  private getCompanyFromToken(token: string | null, tokenType: string): string {
    if (!token) return '';
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const decoded = JSON.parse(jsonPayload);
      console.log(`[Auth Debug] Decoded ${tokenType} Payload:`, decoded);
      
      // Buscar el atributo 'company' en todas las variantes posibles (incluyendo UPN como NIT para Sodexo)
      let company = decoded.company || decoded.Company || decoded.companyId || decoded.company_id || decoded.upn || decoded.UPN;
      
      if (!company && decoded.attributes) {
        company = decoded.attributes.company || decoded.attributes.Company;
      }
      if (!company && decoded.user_attributes) {
        company = decoded.user_attributes.company || decoded.user_attributes.Company;
      }
      if (!company && decoded.profile) {
        company = decoded.profile.company || decoded.profile.Company;
      }
      
      if (Array.isArray(company)) {
        company = company[0];
      }
      
      return company ? String(company).trim() : '';
    } catch (e) {
      console.error(`Error parsing company from ${tokenType}:`, e);
      return '';
    }
  }

  getUserRoles(): string[] {
    const roles: string[] = [];
    const token = this.getToken();
    const idToken = this.getIdToken();
    
    this.extractRolesFromToken(token, roles);
    this.extractRolesFromToken(idToken, roles);
    
    return Array.from(new Set(roles)); // Eliminar duplicados
  }

  private extractRolesFromToken(token: string | null, rolesList: string[]) {
    if (!token) return;
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map((c) => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      const decoded = JSON.parse(jsonPayload);
      
      // 1. Roles del Realm
      if (decoded.realm_access && Array.isArray(decoded.realm_access.roles)) {
        rolesList.push(...decoded.realm_access.roles);
      }
      
      // 2. Roles del Cliente (ej. app-movil-cotel)
      if (decoded.resource_access) {
        for (const clientId of Object.keys(decoded.resource_access)) {
          const clientData = decoded.resource_access[clientId];
          if (clientData && Array.isArray(clientData.roles)) {
            rolesList.push(...clientData.roles);
          }
        }
      }
    } catch (e) {
      // Ignorar errores de parseo
    }
  }

  logout(): void {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('id_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user_data');
  }

  isAuthenticated(): boolean {
    return !!localStorage.getItem('auth_token');
  }
}
