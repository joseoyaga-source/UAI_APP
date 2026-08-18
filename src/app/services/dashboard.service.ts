import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, forkJoin, map, of, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth';

// --- Interfaz para datos básicos de facturas (pagos) ---
export interface DatosBasicosFactura {
  billing_period: string;
  days_billed: number;
  expedition_date: string | null;
  due_date: string;
  total_to_pay: number;
  invoice_number: string;
  payment_date: string | null;
  payment_notes: string | null;
  contract_number: string;
  provider_name: string;
  headquarters_name: string;
  city: string;
  address: string;
  customer_id: string;
  customer_name: string;
}

// --- Interfaces para la respuesta cruda de la API ---
export interface FacturaItem {
  contract_number: string;
  invoice_number: string;
  days_billed: number;
  due_date: string;
  expedition_date: string;
  city: string;
  address: string;
  customer_name: string;
  customer_id: string;
  regex_name: string;
  valor: number;
  item_type: 'Costo' | 'Consumo' | 'Tarifa';
  group_item: string;
  headquarters_name: string;
  headquarters_id?: string;
}

// --- Interfaces para el frontend (dashboard) ---
export interface FacturaSede {
  name: string;
  consumo: string;
  valor: string;
  estado: string;
  porcentaje: number;
  dashArray: string;
  dashOffset: string;
  tarifaPromedio?: number;
}

export interface TendenciaPunto {
  month: string;
  consumoVal: number;   // normalizado 0-100 para SVG
  tarifaVal: number;    // normalizado 0-100 para SVG
  consumoRaw: number;   // kWh reales
  tarifaRaw: number;    // $/kWh real
}

export interface FacturasDashboard {
  gastoTotal: string;
  consumoKwh: number;
  consumoMWh: number;
  co2Valor: string;
  co2Unidad: string;
  equivalenciaArboles: string;
  tarifaPromedio: string;
  gastoCambio?: number;
  sedes: FacturaSede[];
  tendenciaConsumo: TendenciaPunto[];
  reactivaKvarh: number;
}

export type PeriodoFilter = 'mes_actual' | 'ano_actual' | 'ano_pasado';

// --- Interfaz para descarga_facturas_estados ---
export interface DescargaFacturaEstadoItem {
  id: string;
  contract_number: string;
  invoice_number: string;
  billing_period: string;
  due_date: string;
  expedition_date: string;
  payment_status: 'Vencida' | 'Pagada' | 'Por vencer';
  payment_date: string | null;
  days_overdue: number;
  city: string;
  address: string;
  customer_id: string;
  customer_name: string;
  pdf_bucket_name: string;
  pdf_file_name: string;
  total_to_pay: number;
  payment_link: string;
  headquarters_name: string;
  provider_name: string;
}

// --- Interfaz para contratos_sin_facturas_completas ---
export interface ContratoSinFacturaCompletaItem {
  provider_name: string;
  contract_number: string;
  customer_id: string;
  customer_name: string;
  headquarters_name: string;
  city: string;
  address: string;
  missing_month: string;
  expected_invoice_date: string;
  days_overdue: number;
}

/** Item del reporte resumen ejecutivo (monitoreo_equipos) */
export interface ResumenEjecutivoItem {
  equipo: string;
  ubicacion: string;
  indicador: string;
  valor: number;
  unidad: string;
  estado: string;
  nivel_riesgo: string;
  ultima_actualizacion: string;
  [key: string]: any;
}

// --- Interfaces para telemetría de sedes (Medición Inteligente) ---
export interface TelemetriaMensualItem {
  date_record: string;
  customer_id: string;
  customer_name: string;
  headquarters_id: string;
  headquarters_name: string;
  sensor_name: string;
  unit: string;
  variable: string;
  value: number;
}

export interface TelemetriaHorariaItem {
  datetime_record: string;
  customer_id: string;
  customer_name: string;
  headquarters_id: string;
  headquarters_name: string;
  sensor_name: string;
  unit: string;
  variable: string;
  value: number;
}

// --- Interfaz para el reporte UAI Expert (análisis IA por sede) ---
export interface UaiExpertItem {
  id: string;                 // customer_id (NIT)
  customer_name: string;
  headquarters_id: string;
  headquarters_name: string;
  status: string;             // e.g. 'atención', 'óptimo', 'crítico'
  report_title: string;
  report_description: string; // texto con secciones numeradas y viñetas ("\n")
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private apiBase = environment.apiBaseUrl;

  constructor(private http: HttpClient, private authService: AuthService) {}

  /** Perfiles Accept-Profile por endpoint */
  private readonly acceptProfiles: Record<string, string> = {
    reporte_historico_consumos: 'etl_facturas_servicios_publicos',
    reporte_facturas_recibidas: 'etl_facturas_servicios_publicos',
    reporte_facturas_por_recibir: 'etl_facturas_servicios_publicos',
    reporte_resumen_ejecutivo: 'monitoreo_equipos',
    reporte_mantenimiento: 'monitoreo_equipos',
    reporte_alarmas_abiertas: 'monitoreo_equipos',
    reporte_telemetria_actual: 'monitoreo_equipos',
    reporte_telemetria_mensual: 'monitoreo_sedes',
    reporte_telemetria_diaria: 'monitoreo_sedes',
    reporte_telemetria_horaria: 'monitoreo_sedes',
    reporte_uai_expert: 'monitoreo_sedes',
    // UAI Expert de Facturas: resumen ejecutivo de FACTURAS (esquema etl), distinto
    // del resumen ejecutivo de EQUIPOS (monitoreo_equipos) usado en Infraestructura.
    reporte_resumen_ejecutivo_facturas: 'etl_facturas_servicios_publicos'
  };

  private getHeaders(endpoint: string = 'reporte_historico_consumos'): HttpHeaders {
    return new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${environment.apiBearerToken}`,
      'Accept-Profile': this.acceptProfiles[endpoint] || ''
    });
  }

  /**
   * Helper to parse and build the customer filter query based on the company claim.
   * @param moduleType define el fallback de desarrollo.
   * @param column nombre de la columna de cliente en la vista (por defecto 'customer_id';
   *               algunas vistas como reporte_uai_expert la exponen como 'id').
   */
  private getCustomerFilter(moduleType?: 'facturas' | 'infra', column: string = 'customer_id'): string {
    const company = this.authService.getCompany();
    if (!company) {
      // Fallback for development if no session/company is present
      const fallbackId = moduleType === 'infra' ? '900471387' : '800122811';
      return `${column}=eq.${fallbackId}`;
    }

    if (company === '*') {
      return '';
    }

    if (company.includes('|')) {
      const nits = company.split('|').map(n => n.trim()).filter(n => n).join(',');
      return `${column}=in.(${nits})`;
    }

    return `${column}=eq.${company.trim()}`;
  }

  private fechaInicio(periodo: PeriodoFilter): string {
    const hoy = new Date();
    let anio = hoy.getFullYear();
    let mes = hoy.getMonth() + 1;

    switch (periodo) {
      case 'mes_actual':
        return `${anio}-${String(mes).padStart(2, '0')}-01`;
      case 'ano_actual':
        return `${anio}-01-01`;
      case 'ano_pasado':
        return `${anio - 1}-01-01`;
    }
  }

  private fechaFin(periodo: PeriodoFilter): string {
    const hoy = new Date();

    switch (periodo) {
      case 'mes_actual':
      case 'ano_actual':
        return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
      case 'ano_pasado':
        return `${hoy.getFullYear() - 1}-12-31`;
    }
  }

  /** Fechas para el período de comparación (período anterior equivalente) */
  private comparacionFechas(periodo: PeriodoFilter): { inicio: string; fin: string } {
    const hoy = new Date();
    const anio = hoy.getFullYear();
    const mes = hoy.getMonth() + 1;
    const dia = hoy.getDate();

    switch (periodo) {
      case 'mes_actual': {
        // Mes anterior: 1er día → mismo día (o último día del mes anterior si hoy excede)
        const anioPrev = mes === 1 ? anio - 1 : anio;
        const mesPrev = mes === 1 ? 12 : mes - 1;
        const ultimoDia = new Date(anioPrev, mesPrev, 0).getDate();
        const diaComp = Math.min(dia, ultimoDia);
        return {
          inicio: `${anioPrev}-${String(mesPrev).padStart(2, '0')}-01`,
          fin: `${anioPrev}-${String(mesPrev).padStart(2, '0')}-${String(diaComp).padStart(2, '0')}`
        };
      }
      case 'ano_actual': {
        // Mismo período año anterior: 1ro Ene → mismo día y mes
        return {
          inicio: `${anio - 1}-01-01`,
          fin: `${anio - 1}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
        };
      }
      case 'ano_pasado': {
        // Año inmediatamente anterior: 1ro Ene → 31 Dic
        return {
          inicio: `${anio - 2}-01-01`,
          fin: `${anio - 2}-12-31`
        };
      }
    }
  }

  /** Construye URL con filtros: customer_id + rango de expedition_date */
  private buildUrl(periodo: PeriodoFilter): string {
    const gte = this.fechaInicio(periodo);
    const lte = this.fechaFin(periodo);
    const filter = this.getCustomerFilter('facturas');
    const queryParams = [
      filter,
      `expedition_date=gte.${gte}`,
      `expedition_date=lte.${lte}`
    ].filter(p => p).join('&');
    return `${this.apiBase}/reporte_historico_consumos?${queryParams}`;
  }

  /** Obtiene datos crudos de la API filtrados por período */
  getReporteFacturas(periodo: PeriodoFilter = 'ano_actual'): Observable<FacturaItem[]> {
    return this.http.get<FacturaItem[]>(
      this.buildUrl(periodo),
      { headers: this.getHeaders() }
    );
  }

  /** Obtiene datos crudos para el período de comparación */
  private getReporteComparacion(periodo: PeriodoFilter): Observable<FacturaItem[]> {
    const { inicio, fin } = this.comparacionFechas(periodo);
    const filter = this.getCustomerFilter('facturas');
    const queryParams = [
      filter,
      `expedition_date=gte.${inicio}`,
      `expedition_date=lte.${fin}`
    ].filter(p => p).join('&');
    const url = `${this.apiBase}/reporte_historico_consumos?${queryParams}`;
    return this.http.get<FacturaItem[]>(url, { headers: this.getHeaders() });
  }

  /** Obtiene datos transformados para el dashboard según el período */
  getFacturasDashboard(periodo: PeriodoFilter = 'ano_actual'): Observable<FacturasDashboard> {
    return this.getRawFacturas(periodo).pipe(
      map(data => this.buildDashboard(data.current, data.compare))
    );
  }

  getRawFacturas(periodo: PeriodoFilter = 'ano_actual'): Observable<{ current: FacturaItem[], compare: FacturaItem[] }> {
    return forkJoin([
      this.getReporteFacturas(periodo),
      this.getReporteComparacion(periodo)
    ]).pipe(
      map(([current, compare]) => ({ current, compare }))
    );
  }

  buildDashboard(currentItems: FacturaItem[], compItems: FacturaItem[]): FacturasDashboard {
    const dashboard = this.transformToDashboard(currentItems);

    // Calcular % de cambio en gasto
    const gastoActual = currentItems
      .filter(i => i.item_type === 'Costo')
      .reduce((sum, i) => sum + i.valor, 0);
    const gastoComp = compItems
      .filter(i => i.item_type === 'Costo')
      .reduce((sum, i) => sum + i.valor, 0);

    dashboard.gastoCambio = gastoComp > 0
      ? Math.round(((gastoActual - gastoComp) / gastoComp) * 1000) / 10
      : 0;

    return dashboard;
  }

  /** Obtiene datos del resumen ejecutivo (infraestructura) filtrados por cliente */
  getResumenEjecutivo(): Observable<ResumenEjecutivoItem[]> {
    const filter = this.getCustomerFilter('infra');
    const url = `${this.apiBase}/reporte_resumen_ejecutivo` + (filter ? `?${filter}` : '');
    return this.http.get<ResumenEjecutivoItem[]>(url, { headers: this.getHeaders('reporte_resumen_ejecutivo') }).pipe(
      catchError(err => {
        console.error('Error en reporte_resumen_ejecutivo:', err);
        return of([]);
      })
    );
  }

  /**
   * Resumen ejecutivo para el UAI Expert de Facturas.
   * Llaves de la vista: customer_id y headquarters_id.
   * @param customerId  empresa seleccionada (si es 'todos'/vacío se usa el scope de la sesión).
   * @param headquartersId  sede seleccionada (si es 'todas'/vacío no se filtra por sede).
   */
  getReporteResumenEjecutivo(customerId?: string, headquartersId?: string): Observable<ResumenEjecutivoItem[]> {
    const params: string[] = [];
    if (customerId && customerId !== 'todos') {
      params.push(`customer_id=eq.${customerId}`);
    } else {
      const f = this.getCustomerFilter('facturas');
      if (f) params.push(f);
    }
    if (headquartersId && headquartersId !== 'todas') {
      params.push(`headquarters_id=eq.${headquartersId}`);
    }
    const query = params.join('&');
    const url = `${this.apiBase}/reporte_resumen_ejecutivo` + (query ? `?${query}` : '');
    console.log('🧠 UAI Facturas GET:', url);
    return this.http.get<ResumenEjecutivoItem[]>(url, { headers: this.getHeaders('reporte_resumen_ejecutivo_facturas') }).pipe(
      catchError(err => {
        console.error('Error en reporte_resumen_ejecutivo (facturas):', err);
        return of([]);
      })
    );
  }

  getReporteMantenimiento(deviceId: string, customerId?: string): Observable<any[]> {
    if (!deviceId) return of([]);
    let url = `${this.apiBase}/reporte_mantenimiento?device_id=eq.${deviceId}`;
    if (customerId) {
      url += `&customer_id=eq.${customerId}`;
    } else {
      const filter = this.getCustomerFilter('infra');
      if (filter) url += `&${filter}`;
    }
    return this.http.get<any[]>(url, { headers: this.getHeaders('reporte_mantenimiento') }).pipe(
      catchError(err => {
        console.error('Error en reporte_mantenimiento:', err);
        return of([]);
      })
    );
  }

  getReporteAlarmasAbiertas(deviceId?: string): Observable<any[]> {
    const filter = this.getCustomerFilter('infra');
    let url = `${this.apiBase}/reporte_alarmas_abiertas` + (filter ? `?${filter}` : '?');
    if (deviceId) {
      url += (url.endsWith('?') ? '' : '&') + `device_id=eq.${deviceId}`;
    }
    if (url.endsWith('?')) {
      url = url.slice(0, -1);
    }
    return this.http.get<any[]>(url, { headers: this.getHeaders('reporte_alarmas_abiertas') }).pipe(
      catchError(err => {
        console.error('Error en reporte_alarmas_abiertas:', err);
        return of([]);
      })
    );
  }

  getReporteTelemetriaActual(deviceId: string, customerId?: string): Observable<any[]> {
    if (!deviceId) return of([]);
    let url = `${this.apiBase}/reporte_telemetria_actual?device_id=eq.${deviceId}`;
    if (customerId) {
      url += `&customer_id=eq.${customerId}`;
    } else {
      const filter = this.getCustomerFilter('infra');
      if (filter) url += `&${filter}`;
    }
    return this.http.get<any[]>(url, { headers: this.getHeaders('reporte_telemetria_actual') }).pipe(
      catchError(err => {
        console.error('Error en reporte_telemetria_actual:', err);
        return of([]);
      })
    );
  }

  // --- Transformaciones de Datos ---
  public transformToDashboard(items: FacturaItem[]): FacturasDashboard {
    // Agrupar por sede (headquarters_name)
    const sedeMap = new Map<string, FacturaItem[]>();
    for (const item of items) {
      const sede = item.headquarters_name;
      if (!sedeMap.has(sede)) {
        sedeMap.set(sede, []);
      }
      sedeMap.get(sede)!.push(item);
    }

    // Calcular totales globales
    const totalGasto = items
      .filter(i => i.item_type === 'Costo')
      .reduce((sum, i) => sum + i.valor, 0);

    // Consumo energía total (kWh crudo sin redondear)
    const totalConsumoKwh = items
      .filter(i => i.regex_name === 'Consumo Energía Activa Kwh')
      .reduce((sum, i) => sum + i.valor, 0);
    // Para compatibilidad con código legado (no lo usamos en la formula CO2)
    const totalConsumoMWh = totalConsumoKwh / 1000;

    // Energía Reactiva Penalizada:
    // Se usa el campo "Valor Total Consumo Energía Reactiva" (item_type = 'Costo').
    // Si la suma es > 0 hay penalización y se muestra ese valor.
    const reactivaKvarh = items
      .filter(i => i.regex_name === 'Valor Total Consumo Energía Reactiva' && i.item_type === 'Costo')
      .reduce((sum, i) => sum + i.valor, 0);
    console.log('[UAI Debug] Reactiva penalizada (Valor Total):', reactivaKvarh);

    // Tarifa promedio de energía
    const tarifasEnergia = items
      .filter(i => i.regex_name === 'Tarifa Consumo Energía Activa Kwh');
    const tarifaPromedio = tarifasEnergia.length > 0
      ? tarifasEnergia.reduce((sum, i) => sum + i.valor, 0) / tarifasEnergia.length
      : 0;

    // CO2: formula correcta = kWh x 0.21742 / 1000 (ton CO2)
    const co2Toneladas = (totalConsumoKwh * 0.21742) / 1000;
    const arbolesEquivalentes = Math.round(co2Toneladas * 46);

    // Construir sedes con porcentajes
    const totalParaPorcentaje = totalGasto > 0 ? totalGasto : 1;
    const sedesArray = Array.from(sedeMap.entries());
    const sedes: FacturaSede[] = [];
    let acumOffset = 0;

    sedesArray.forEach(([sedeName, sedeItems]) => {
      const costoSede = sedeItems
        .filter(i => i.item_type === 'Costo')
        .reduce((sum, i) => sum + i.valor, 0);
      const consumoSedeKwh = sedeItems
        .filter(i => i.regex_name === 'Consumo Energía Activa Kwh')
        .reduce((sum, i) => sum + i.valor, 0);
      const tarifasItems = sedeItems.filter(i => i.regex_name === 'Tarifa Consumo Energía Activa Kwh');
      const tarifaAvg = tarifasItems.length > 0 
        ? tarifasItems.reduce((sum, i) => sum + i.valor, 0) / tarifasItems.length 
        : 0;

      const pct = (costoSede / totalParaPorcentaje) * 100;
      // Circunferencia base ≈ 100 (2×π×15.9155)
      const dashLen = pct;
      const dashOff = -acumOffset;

      sedes.push({
        name: sedeName,
        consumo: `${(consumoSedeKwh / 1000).toFixed(1)} MWh`,
        valor: `$${costoSede.toLocaleString('es-CO')}`,
        estado: this.determinarEstado(sedeItems),
        porcentaje: Math.round(pct * 10) / 10,
        dashArray: dashLen.toFixed(1),
        dashOffset: dashOff.toFixed(1),
        tarifaPromedio: tarifaAvg
      });

      acumOffset += pct;
    });

    // Tendencia mensual: consumo Y tarifa por mes
    const consumoPorMes = new Map<string, number>();
    const tarifaPorMesSum = new Map<string, number>();
    const tarifaPorMesCnt = new Map<string, number>();

    const monthNamesOrder = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const monthNames = monthNamesOrder;

    items
      .filter(i => i.expedition_date)
      .forEach(i => {
        const date = new Date(i.expedition_date);
        const m = monthNames[date.getMonth()];
        if (!m) return;

        if (i.regex_name === 'Consumo Energía Activa Kwh') {
          consumoPorMes.set(m, (consumoPorMes.get(m) || 0) + i.valor);
        }
        if (i.regex_name === 'Tarifa Consumo Energía Activa Kwh') {
          tarifaPorMesSum.set(m, (tarifaPorMesSum.get(m) || 0) + i.valor);
          tarifaPorMesCnt.set(m, (tarifaPorMesCnt.get(m) || 0) + 1);
        }
      });

    // Meses que tienen al menos consumo
    const mesesActivos = monthNamesOrder.filter(m => consumoPorMes.has(m));

    let tendenciaConsumo: TendenciaPunto[];

    if (mesesActivos.length === 0) {
      tendenciaConsumo = [
        { month: 'Ene', consumoVal: 45, tarifaVal: 60, consumoRaw: 0, tarifaRaw: 0 },
        { month: 'Feb', consumoVal: 52, tarifaVal: 55, consumoRaw: 0, tarifaRaw: 0 },
        { month: 'Mar', consumoVal: 48, tarifaVal: 70, consumoRaw: 0, tarifaRaw: 0 },
        { month: 'Abr', consumoVal: 60, tarifaVal: 65, consumoRaw: 0, tarifaRaw: 0 },
      ];
    } else {
      const rawConsumo = mesesActivos.map(m => consumoPorMes.get(m) || 0);
      const rawTarifa = mesesActivos.map(m => {
        const cnt = tarifaPorMesCnt.get(m) || 1;
        return (tarifaPorMesSum.get(m) || 0) / cnt;
      });

      const maxC = Math.max(...rawConsumo, 1);
      const minC = Math.min(...rawConsumo);
      const rangeC = maxC - minC || 1;

      const maxT = Math.max(...rawTarifa, 1);
      const minT = Math.min(...rawTarifa);
      const rangeT = maxT - minT || 1;

      tendenciaConsumo = mesesActivos.map((m, idx) => ({
        month: m,
        consumoRaw: rawConsumo[idx],
        tarifaRaw: rawTarifa[idx],
        // Normalizar: min->10, max->90 para dejar margen visual
        consumoVal: Math.round(10 + ((rawConsumo[idx] - minC) / rangeC) * 80),
        tarifaVal: Math.round(10 + ((rawTarifa[idx] - minT) / rangeT) * 80),
      }));
    }

    return {
      gastoTotal: `$${(totalGasto / 1_000_000).toFixed(1).replace('.', ',')}M`,
      consumoKwh: totalConsumoKwh,
      consumoMWh: totalConsumoMWh,
      co2Valor: co2Toneladas.toFixed(2),
      co2Unidad: 't',
      equivalenciaArboles: `${arbolesEquivalentes} Árb.`,
      tarifaPromedio: `$${Math.round(tarifaPromedio)}`,
      sedes,
      tendenciaConsumo,
      reactivaKvarh: Math.round(reactivaKvarh)
    };
  }

  private determinarEstado(items: FacturaItem[]): string {
    const hoy = new Date();
    for (const item of items) {
      if (item.due_date) {
        const vencimiento = new Date(item.due_date);
        if (vencimiento < hoy) {
          return 'Pago Vencido';
        }
      }
    }
    return 'Al Día';
  }

  /**
   * Obtiene facturas con payment_date nulo (no pagadas) para el cliente de facturas.
   * Filtra por customer_id y trae todos los registros sin payment_date.
   */
  getDatosBasicosFacturas(): Observable<DatosBasicosFactura[]> {
    const filter = this.getCustomerFilter('facturas');
    const url = `${this.apiBase}/reporte_facturas_recibidas` + (filter ? `?${filter}` : '');
    return this.http.get<DatosBasicosFactura[]>(url, {
      headers: this.getHeaders('reporte_facturas_recibidas')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_facturas_recibidas:', err);
        return of([]);
      })
    );
  }
  /**
   * Obtiene el estado de todos los contratos del cliente de facturas.
   */
  getEstadosContratos(): Observable<any[]> {
    const filter = this.getCustomerFilter('facturas');
    const url = `${this.apiBase}/reporte_estados_contratos` + (filter ? `?${filter}` : '');
    return this.http.get<any[]>(url, {
      headers: this.getHeaders('reporte_historico_consumos')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_estados_contratos:', err);
        return of([]);
      })
    );
  }

  /**
   * Obtiene el estado de pago de todas las facturas del cliente
   * desde la vista facturas_recibidas.
   */
  getFacturasRecibidas(): Observable<DescargaFacturaEstadoItem[]> {
    const filter = this.getCustomerFilter('facturas');
    const url = `${this.apiBase}/reporte_facturas_recibidas` + (filter ? `?${filter}` : '');
    return this.http.get<DescargaFacturaEstadoItem[]>(url, {
      headers: this.getHeaders('reporte_facturas_recibidas')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_facturas_recibidas:', err);
        return of([]);
      })
    );
  }

  /**
   * Obtiene los contratos que tienen meses de factura faltantes
   * desde la vista reporte_facturas_por_recibir.
   */
  getReporteFacturasPorRecibir(): Observable<ContratoSinFacturaCompletaItem[]> {
    const filter = this.getCustomerFilter('facturas');
    const url = `${this.apiBase}/reporte_facturas_por_recibir` + (filter ? `?${filter}` : '');
    return this.http.get<ContratoSinFacturaCompletaItem[]>(url, {
      headers: this.getHeaders('reporte_facturas_por_recibir')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_facturas_por_recibir:', err);
        return of([]);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Telemetría de Sedes — Medición Inteligente
  // ═══════════════════════════════════════════════════════════════

  /** Telemetría mensual: un registro por sensor por mes */
  getReporteTelemetriaMensual(): Observable<TelemetriaMensualItem[]> {
    const filter = this.getCustomerFilter('infra');
    const url = `${this.apiBase}/reporte_telemetria_mensual` + (filter ? `?${filter}` : '');
    return this.http.get<TelemetriaMensualItem[]>(url, {
      headers: this.getHeaders('reporte_telemetria_mensual')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_telemetria_mensual:', err);
        return of([]);
      })
    );
  }

  /** Telemetría diaria: registros por sensor por día del mes indicado */
  getReporteTelemetriaDiaria(year: number, month: number): Observable<TelemetriaMensualItem[]> {
    const filter = this.getCustomerFilter('infra');
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(year, month, 0).getDate();
    const dateGte = `${year}-${mm}-01`;
    const dateLte = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    const params = [
      filter,
      `date_record=gte.${dateGte}`,
      `date_record=lte.${dateLte}`
    ].filter(p => p).join('&');
    const url = `${this.apiBase}/reporte_telemetria_diaria?${params}`;
    return this.http.get<TelemetriaMensualItem[]>(url, {
      headers: this.getHeaders('reporte_telemetria_diaria')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_telemetria_diaria:', err);
        return of([]);
      })
    );
  }

  /** Telemetría horaria: registros por sensor para un día específico (00:00 – 23:59) en hora LOCAL del usuario */
  getReporteTelemetriaHoraria(date: string): Observable<TelemetriaHorariaItem[]> {
    const filter = this.getCustomerFilter('infra');
    const { utcStart, utcEnd } = DashboardService.getLocalDayUtcRange(date);
    const params = [
      filter,
      `datetime_record=gte.${utcStart}`,
      `datetime_record=lte.${utcEnd}`
    ].filter(p => p).join('&');
    const url = `${this.apiBase}/reporte_telemetria_horaria?${params}`;
    return this.http.get<TelemetriaHorariaItem[]>(url, {
      headers: this.getHeaders('reporte_telemetria_horaria')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_telemetria_horaria:', err);
        return of([]);
      })
    );
  }

  /**
   * Reporte UAI Expert: análisis IA del comportamiento energético por sede.
   * Filtra por cliente (columna `id`) y, opcionalmente, por sede (`headquarters_name`).
   * La vista vive en el esquema público, por lo que no requiere Accept-Profile.
   */
  getReporteUaiExpert(allCustomers = false): Observable<UaiExpertItem[]> {
    const params: string[] = [];

    // Filtro por cliente (columna 'id' en esta vista), usando la MISMA resolución que la
    // telemetría de Medición ('infra') para que las sedes coincidan. Se omite si allCustomers.
    // La sede se filtra en el cliente por headquarters_id (ver applyUaiSedeFilter).
    if (!allCustomers) {
      const filter = this.getCustomerFilter('infra', 'id');
      if (filter) params.push(filter);
    }

    const query = params.join('&');
    const url = `${this.apiBase}/reporte_uai_expert` + (query ? `?${query}` : '');
    console.log('🤖 UAI Expert GET:', url);
    return this.http.get<UaiExpertItem[]>(url, {
      headers: this.getHeaders('reporte_uai_expert')
    }).pipe(
      catchError(err => {
        console.error('Error en reporte_uai_expert:', err);
        return of([]);
      })
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Utilidades de Zona Horaria
  // ═══════════════════════════════════════════════════════════════

  /** Retorna la zona horaria IANA del dispositivo/navegador (e.g. 'America/Bogota') */
  static getUserTimezone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  /** Retorna la fecha actual en formato YYYY-MM-DD en hora local del usuario */
  static getLocalDateString(d?: Date): string {
    const now = d ?? new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Dado un string de fecha 'YYYY-MM-DD', retorna los timestamps que cubren el inicio
   * (00:00:00) y fin (23:59:59) del día, tal cual, SIN ajuste de zona horaria (UTC).
   * Se usan directamente para consultar la API con la misma hora que ésta almacena.
   */
  static getLocalDayUtcRange(localDateStr: string): { utcStart: string; utcEnd: string } {
    // Rango del día sin conversión de zona horaria: se envía la fecha/hora tal cual.
    const utcStart = `${localDateStr}T00:00:00`;
    const utcEnd = `${localDateStr}T23:59:59`;
    return { utcStart, utcEnd };
  }
}
