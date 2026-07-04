import { Component, HostListener, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../services/auth';
import { DashboardService, FacturasDashboard, FacturaSede, TendenciaPunto, PeriodoFilter, ResumenEjecutivoItem, DatosBasicosFactura } from '../services/dashboard.service';

interface PeriodoOption {
  value: PeriodoFilter;
  label: string;
  shortLabel: string;
  icon: string;
}

interface InfraStats {
  label: string;
  value: string;
}

interface InfraPriority {
  name: string;
  riesgo: string;
  status: string;
}

interface ActionCard {
  level: 'critico' | 'alerta' | 'estable';
  equipo: string;
  ubicacion: string;
  quePasa: string;
  porque: string;
  item: ResumenEjecutivoItem;
}

// AccordeonGroup removed — replaced by flat ActionCards

interface UaiVariable {
  icono: string;
  nombre: string;
  valor: string;
  anormal: boolean;
  group: 'equipo' | 'estado' | 'mantenimiento' | 'telemetria';
}

interface UaiDiagnostic {
  equipo: string;
  serial: string;
  estado: string;
  tiempoAlarma: string;
  problema: string;
  contexto: string;
  accionRecomendada: string;
  reportDescription: string;
  formattedDescription: SafeHtml;
  variables: UaiVariable[];
}

interface InfraData {
  efficiency: string;
  status: string;
  stats: InfraStats[];
  priorities: InfraPriority[];
}

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrl: './home.page.scss',
  standalone: true,
  imports: [IonContent, CommonModule, FormsModule]
})
export class HomePage implements OnInit {
  activeTab: 'resumen' | 'historial' | 'equipos' | 'reportes' | 'detalle' | 'alarmas' = 'resumen';
  infraItems: ResumenEjecutivoItem[] = [];
  showProfileDropdown = false;
  @ViewChild('profileDropdown') profileDropdown?: ElementRef;
  @ViewChild(IonContent) ionContent?: IonContent;

  // --- App Shell Context Switcher ---
  currentContext: 'Gestión de Facturas' | 'Infraestructura' = 'Gestión de Facturas';
  showContextDropdown = false;

  userCompany = 'Bancolombia S.A';
  userAvatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=120&auto=format&fit=crop';

  // --- Período ---
  readonly periodos: PeriodoOption[] = [
    { value: 'mes_actual', label: 'Mes Actual', shortLabel: 'Mes', icon: 'calendar_month' },
    { value: 'ano_actual', label: 'Año Actual', shortLabel: 'Año', icon: 'calendar_today' },
    { value: 'ano_pasado', label: 'Año Anterior', shortLabel: 'Año Ant.', icon: 'history' }
  ];
  selectedPeriod: PeriodoFilter = 'ano_actual';
  showPeriodDropdown = false;
  
  detalleMetric: 'costo' | 'consumo' | 'tarifa' = 'costo';

  getSelectedPeriodLabel() {
    return this.periodos.find(p => p.value === this.selectedPeriod)?.label || 'Seleccionar Período';
  }

  // --- Datos de facturas ---
  facturasData: FacturasDashboard = {
    gastoTotal: '$0M',
    consumoKwh: 0,
    consumoMWh: 0,
    co2Valor: '0',
    co2Unidad: 't',
    equivalenciaArboles: '0 Árb.',
    tarifaPromedio: '$0',
    gastoCambio: 0,
    sedes: [],
    tendenciaConsumo: [] as TendenciaPunto[],
    reactivaKvarh: 0
  };
  // --- Mock Data para nueva vista de Facturas ---
  reactivaPenalizadaMock = 12500; // Valor mock > 0 para forzar borde ámbar/rojo
  co2CambioMock = -2.4; // % de cambio frente al periodo anterior


  get calculatedCO2() {
    // Ton CO2 = kWh * 0.21742 / 1000  (usando kWh crudo, no MWh redondeado)
    return ((this.facturasData.consumoKwh * 0.21742) / 1000).toFixed(2);
  }
  
  private parseMetricValue(str: string): number {
    if (!str) return 0;
    if (str.includes('MWh') || str.includes('kWh')) {
      return parseFloat(str.replace(/[^\d.-]/g, '')) || 0;
    } else {
      let cleaned = str.replace(/[^\d.,]/g, '');
      cleaned = cleaned.replace(/\./g, '');
      cleaned = cleaned.replace(/,/g, '.');
      return parseFloat(cleaned) || 0;
    }
  }

  get sortedDetalleSedes() {
    return [...this.facturasData.sedes].sort((a, b) => {
      let valA = 0, valB = 0;
      if (this.detalleMetric === 'consumo') {
        valA = this.parseMetricValue(a.consumo);
        valB = this.parseMetricValue(b.consumo);
      } else if (this.detalleMetric === 'costo') {
        valA = this.parseMetricValue(a.valor);
        valB = this.parseMetricValue(b.valor);
      } else {
        const costoA = this.parseMetricValue(a.valor);
        const consA = this.parseMetricValue(a.consumo);
        valA = consA > 0 ? costoA / (consA * 1000) : 0;

        const costoB = this.parseMetricValue(b.valor);
        const consB = this.parseMetricValue(b.consumo);
        valB = consB > 0 ? costoB / (consB * 1000) : 0;
      }
      return valB - valA;
    });
  }

  // --- SVG Dual-Axis Chart ---
  private buildSvgPath(data: TendenciaPunto[], key: 'consumoVal' | 'tarifaVal'): string {
    if (!data || data.length === 0) return '';
    if (data.length === 1) {
      const y = 100 - data[0][key];
      return `M 0,${y} L 100,${y}`;
    }
    let path = '';
    const xStep = 100 / (data.length - 1);
    data.forEach((item, index) => {
      const x = index * xStep;
      const y = 100 - item[key];
      if (index === 0) {
        path += `M ${x},${y} `;
      } else {
        const prevX = (index - 1) * xStep;
        const prevY = 100 - data[index - 1][key];
        const cpX = prevX + xStep / 2;
        path += `C ${cpX},${prevY} ${cpX},${y} ${x},${y} `;
      }
    });
    return path;
  }

  get trendSvgPath(): string {
    return this.buildSvgPath(this.facturasData.tendenciaConsumo, 'consumoVal');
  }
  get trendSvgArea(): string {
    const p = this.trendSvgPath;
    return p ? `${p} L 100,100 L 0,100 Z` : '';
  }
  get tarifaSvgPath(): string {
    return this.buildSvgPath(this.facturasData.tendenciaConsumo, 'tarifaVal');
  }

  // Labels eje izquierdo (tarifa) y derecho (consumo)
  get tarifaAxisLabels(): string[] {
    const data = this.facturasData.tendenciaConsumo;
    if (!data || data.length === 0) return ['', '', ''];
    const vals = data.map(d => d.tarifaRaw).filter(v => v > 0);
    if (vals.length === 0) return ['', '', ''];
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const mid = (max + min) / 2;
    return [`$${Math.round(max)}`, `$${Math.round(mid)}`, `$${Math.round(min)}`];
  }

  get consumoAxisLabels(): string[] {
    const data = this.facturasData.tendenciaConsumo;
    if (!data || data.length === 0) return ['', '', ''];
    const vals = data.map(d => d.consumoRaw).filter(v => v > 0);
    if (vals.length === 0) return ['', '', ''];
    const maxMwh = Math.max(...vals) / 1000;
    const minMwh = Math.min(...vals) / 1000;
    const midMwh = (maxMwh + minMwh) / 2;
    return [`${maxMwh.toFixed(1)}`, `${midMwh.toFixed(1)}`, `${minMwh.toFixed(1)}`];
  }

  getDetalleValue(sede: FacturaSede): string {
    if (this.detalleMetric === 'costo') {
      // Sin decimales
      return sede.valor.replace(/[,]\d+$/, '');
    }
    if (this.detalleMetric === 'consumo') return sede.consumo;
    
    // Devolver el promedio real de Tarifa por sede
    const tarifa = sede.tarifaPromedio || 0;
    return `$${Math.round(tarifa)} / kWh`;
  }
  isLoadingFacturas = false;
  facturasError = '';

  // --- Alarmas por facturas faltantes (por contrato) ---
  facturasRawItems: any[] = [];
  missingInvoiceAlarms: { contractNumber: string; lastDate: string; expectedMonth: string; customerName?: string; customerId?: string }[] = [];

  // --- Alarmas por facturas pendientes de pago (payment_date null + due_date <= 5 días) ---
  pendingPaymentAlarms: { invoiceNumber: string; contractNumber: string; headquartersName: string; expeditionDate: string; dueDate: string; totalToPay: string; daysLeft: number; customerName?: string; customerId?: string }[] = [];

  // --- Contratos ---
  estadosContratos: any[] = [];
  isLoadingContratos = false;
  contratosAgrupar = true; // toggle agrupar / desagrupar
  contratosGroupsExpanded: Record<string, boolean> = {
    Activo: false,
    Cancelado: false
  };

  get contratosAgrupados(): { estado: string; items: any[] }[] {
    const groups: Record<string, any[]> = {};
    for (const c of this.estadosContratos) {
      const key = c.state || 'Otro';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    // Activo primero
    return Object.entries(groups)
      .sort(([a], [b]) => (a === 'Activo' ? -1 : b === 'Activo' ? 1 : a.localeCompare(b)))
      .map(([estado, items]) => ({ estado, items }));
  }

  toggleContratosGroup(estado: string) {
    this.contratosGroupsExpanded[estado] = !this.contratosGroupsExpanded[estado];
  }

  // --- Mock Data para Historial ---
  historialFacturasMock = [
    { contrato: 'CT-9012', costoTotal: '$4,250,000', consumoTotal: '9.2 MWh', periodo: 'Mayo 2026' },
    { contrato: 'CT-9012', costoTotal: '$4,100,000', consumoTotal: '8.9 MWh', periodo: 'Abril 2026' },
    { contrato: 'CT-9012', costoTotal: '$3,950,000', consumoTotal: '8.5 MWh', periodo: 'Marzo 2026' },
  ];

  get notifications(): { title: string; subtitle: string; detail: string; type: string; serial?: string; date?: string; rawItem?: any }[] {
    if (this.currentContext === 'Gestión de Facturas') {
      // Alarmas de facturas faltantes por contrato
      const missingAlarms = this.missingInvoiceAlarms.map(m => {
        const clientPrefix = this.hasMultipleCustomers() ? `[${m.customerName || m.customerId || ''}] ` : '';
        return {
          title: `${clientPrefix}⚠️ Factura No Recibida`,
          subtitle: `Contrato: ${m.contractNumber}`,
          detail: `Factura de ${m.expectedMonth} no ha llegado. Última recibida: ${m.lastDate}`,
          type: 'alarm'
        };
      });
      // Alarmas de pago: vencidas o por vencer en ≤ 5 días (desde reporte_datos_basicos_facturas)
      const pendingAlarms = this.pendingPaymentAlarms.map(p => {
        const clientPrefix = this.hasMultipleCustomers() ? `[${p.customerName || p.customerId || ''}] ` : '';
        return {
          title: p.daysLeft < 0
            ? `${clientPrefix}🔴 Pago Vencido — Contrato ${p.contractNumber}`
            : `${clientPrefix}🟡 Vence en ${p.daysLeft} día${p.daysLeft !== 1 ? 's' : ''} — Contrato ${p.contractNumber}`,
          subtitle: `${p.headquartersName} • Vencimiento: ${p.dueDate}`,
          detail: `Factura ${p.invoiceNumber} • Expedida: ${p.expeditionDate} • Total: ${p.totalToPay}`,
          type: 'alarm'
        };
      });
      return [...missingAlarms, ...pendingAlarms];
    } else {
      // Use enriched alarms if available, otherwise fall back to alarmasItems
      if (this.alarmasAbiertas.length > 0) {
        return this.alarmasAbiertas
          .filter(a => {
            const cat = (a.alarm_category ?? '').toLowerCase();
            const desc = (a.alarm_description ?? '').toLowerCase();
            return !cat.includes('comunic') && !desc.includes('comunic') && !desc.includes('communication');
          })
          .map(a => {
            const clientPrefix = this.hasMultipleCustomers() ? `[${this.getCustomerName(a)}] ` : '';
            return {
              title: `${clientPrefix}${a.device_name ?? 'Equipo Alarmado'}`,
              subtitle: `${a.alarm_category ?? ''} • Severidad: ${a.severity ?? '—'}`,
              detail: a.alarm_description ?? 'Sin descripción disponible.',
              type: 'warning',
              serial: a.serial_number_device ?? a.device_id ?? '—',
              date: a.record_date ? a.record_date.split(/[ T]/)[0] : '—',
              rawItem: a
            };
          });
      }
      return this.alarmasItems.map(a => ({
        title: 'Equipo en Alarma',
        subtitle: a.equipo,
        detail: `Serial: ${a.serial}`,
        type: 'warning',
        serial: a.serial ?? '—',
        rawItem: a
      }));
    }
  }

  handleNotificationClick(notification: any) {
    if (notification.rawItem) {
      this.closeNotifications();
      this.activeTab = 'equipos';
      const raw = { ...notification.rawItem, alarms_counted: 1 };
      
      const device = this.infraItems.find(i => i['device_id'] === raw.device_id);
      if (device) {
        const fullItem = { ...device, alarms_counted: 1 };
        this.showUaiDetailForItem(fullItem);
      } else {
        this.showUaiDetailForItem(raw);
      }
    }
  }

  handleAlarmClick(alarm: any) {
    this.activeTab = 'equipos';
    const device = this.infraItems.find(i => i['device_id'] === alarm.device_id);
    if (device) {
      const fullItem = { ...device, alarms_counted: 1 };
      this.showUaiDetailForItem(fullItem);
    } else {
      const raw = { ...alarm, alarms_counted: 1 };
      this.showUaiDetailForItem(raw);
    }
  }

  showNotificationsPanel = false;

  buildingData = {
    kpis: [
      { title: 'Consumo Comercial', value: '472.6 kWh', meta: 'Meta: 450 kWh', trend: 'up', color: 'text-error' },
      { title: 'Áreas Climatizadas', value: '239.8 kW', meta: 'Balance +12.3%', trend: 'stable', color: 'text-secondary' },
      { title: 'Generación Solar', value: '63.3 kW', meta: 'Rendimiento +20.5%', trend: 'down', color: 'text-primary' }
    ],
    umas: [
      { tag: 'UMA-01', location: 'Piso 1 - Oficinas', temp: '21.5°C', status: 'Operando', mode: 'Cooling' },
      { tag: 'UMA-02', location: 'Piso 2 - Servidores', temp: '19.0°C', status: 'Crítico', mode: 'Max Cooling' },
      { tag: 'UMA-03', location: 'Piso 3 - Lobby', temp: '23.0°C', status: 'Standby', mode: 'Fan Only' }
    ]
  };

  infraData: InfraData = {
    efficiency: '—',
    status: 'Cargando…',
    stats: [],
    priorities: []
  };

  isLoadingInfra = false;
  infraError = '';
  showAlarmas = false;
  alarmasItems: { equipo: string; serial: string; estado: string }[] = [];
  alarmasAbiertas: any[] = [];
  alarmGroupsExpanded: { [category: string]: boolean } = {};
  alarmDeviceExpanded: { [key: string]: boolean } = {};
  deviceTypesCount: { type: string; total: number; critico: number; alerta: number; estable: number; pct: number; icon: string }[] = [];
  selectedDeviceType: string | null = null;

  // Nuevo diseño: Action Cards + UAI Expert
  showUaiDetail = false;
  isLoadingUai = false;
  uaiDiagnostic: UaiDiagnostic | null = null;
  actionCards: ActionCard[] = [];

  groupsExpanded: Record<'critico' | 'alerta' | 'estable', boolean> = {
    critico: false,
    alerta: false,
    estable: false
  };



  constructor(
    private router: Router,
    private authService: AuthService,
    private dashboardService: DashboardService,
    private sanitizer: DomSanitizer
  ) {

  }

  ngOnInit() {
  }

  hasFinanzasAccess(): boolean {
    const roles = this.authService.getUserRoles();
    if (roles.length === 0) return true; // dev fallback
    return roles.some(r => {
      const lower = r.toLowerCase();
      return lower.includes('finanzas') || lower.includes('financiero');
    });
  }

  hasInfraAccess(): boolean {
    const roles = this.authService.getUserRoles();
    if (roles.length === 0) return true; // dev fallback
    return roles.some(r => {
      const lower = r.toLowerCase();
      return lower.includes('infraestructura');
    });
  }

  ionViewWillEnter() {
    this.resetState();

    // Determinar contexto por defecto según roles
    const canFinanzas = this.hasFinanzasAccess();
    const canInfra = this.hasInfraAccess();

    if (!canFinanzas && canInfra) {
      this.currentContext = 'Infraestructura';
      this.activeTab = 'equipos';
    } else {
      this.currentContext = 'Gestión de Facturas';
      this.activeTab = 'resumen';
    }

    this.userCompany = this.authService.getGivenName();

    if (canFinanzas) {
      this.loadFacturasData();
      this.loadPendingPaymentAlarms();
      this.loadEstadosContratos();
    }
    if (canInfra) {
      this.loadInfraData();
    }
  }

  private resetState() {
    this.activeTab = 'resumen';
    this.currentContext = 'Gestión de Facturas';
    this.infraItems = [];
    this.userCompany = 'Usuario';
    this.facturasData = {
      gastoTotal: '$0M',
      consumoKwh: 0,
      consumoMWh: 0,
      co2Valor: '0',
      co2Unidad: 't',
      equivalenciaArboles: '0 Árb.',
      tarifaPromedio: '$0',
      gastoCambio: 0,
      sedes: [],
      tendenciaConsumo: [] as TendenciaPunto[],
      reactivaKvarh: 0
    };
    this.estadosContratos = [];
    this.alarmasItems = [];
    this.alarmasAbiertas = [];
    this.actionCards = [];
    this.deviceTypesCount = [];
    this.selectedDeviceType = null;
    this.pendingPaymentAlarms = [];
    this.missingInvoiceAlarms = [];
    this.facturasRawItems = [];
  }

  /** Cambia el período y recarga datos */
  selectPeriodo(periodo: PeriodoFilter) {
    this.showPeriodDropdown = false;
    if (this.selectedPeriod === periodo) return;
    this.selectedPeriod = periodo;
    this.loadFacturasData();
  }

  togglePeriodDropdown() {
    this.showPeriodDropdown = !this.showPeriodDropdown;
  }

  private loadEstadosContratos() {
    this.isLoadingContratos = true;
    this.dashboardService.getEstadosContratos().subscribe({
      next: (items) => {
        // Ordenar por sede (headquarters_name) alfabéticamente
        this.estadosContratos = items.sort((a, b) => {
          const nameA = (a.headquarters_name || '').toLowerCase();
          const nameB = (b.headquarters_name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        this.isLoadingContratos = false;
      },
      error: () => { this.isLoadingContratos = false; }
    });
  }

  /**
   * Carga las facturas básicas desde reporte_datos_basicos_facturas.
   * Filtra las que tienen payment_date nulo (no pagadas) y cuya due_date
   * vence en 5 días o menos (incluyendo vencidas). Genera alarmas para cada una.
   */
  private loadPendingPaymentAlarms() {
    this.dashboardService.getDatosBasicosFacturas().subscribe({
      next: (items: DatosBasicosFactura[]) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const DAYS_THRESHOLD = 5;

        const alarms: typeof this.pendingPaymentAlarms = [];

        // Filtrar solo las no pagadas
        const unpaid = items.filter(i => !i.payment_date);

        for (const inv of unpaid) {
          if (!inv.due_date) continue;

          const due = new Date(inv.due_date);
          due.setHours(0, 0, 0, 0);
          const daysLeft = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Alarmar si ya venció (sin límite) O vence en ≤ 5 días
          if (daysLeft <= DAYS_THRESHOLD) {
            alarms.push({
              invoiceNumber: inv.invoice_number,
              contractNumber: inv.contract_number,
              headquartersName: inv.headquarters_name,
              expeditionDate: inv.expedition_date ?? '—',
              dueDate: inv.due_date,
              totalToPay: `$${inv.total_to_pay.toLocaleString('es-CO')}`,
              daysLeft,
              customerName: inv.customer_name || '',
              customerId: inv.customer_id || ''
            });
          }
        }

        // Ordenar: primero los vencidos (daysLeft negativo), luego por urgencia
        this.pendingPaymentAlarms = alarms.sort((a, b) => a.daysLeft - b.daysLeft);
        console.log(`💳 Facturas pendientes de pago con alarma: ${alarms.length}`, alarms);
      },
      error: (err) => {
        console.error('❌ Error al cargar facturas básicas:', err);
      }
    });
  }

  private loadFacturasData() {
    this.isLoadingFacturas = true;
    this.facturasError = '';

    // Cargar dashboard del período seleccionado
    this.dashboardService.getFacturasDashboard(this.selectedPeriod).subscribe({
      next: (dashboardData) => {
        console.log(`📊 Facturas [${this.selectedPeriod}]:`, dashboardData);
        this.isLoadingFacturas = false;
        this.facturasData = dashboardData;
      },
      error: (err) => {
        console.error('❌ Error al cargar facturas:', err);
        this.isLoadingFacturas = false;
        if (err.status === 401 || err.status === 403) {
          this.facturasError = 'Sesión expirada. Verifica el token de API.';
        } else {
          this.facturasError = 'No se pudieron cargar los datos.';
        }
      }
    });

    // Cargar items crudos del año actual para detectar facturas faltantes
    this.dashboardService.getReporteFacturas('ano_actual').subscribe({
      next: (rawItems) => {
        this.facturasRawItems = rawItems || [];
        this.detectMissingInvoiceAlarms();
      },
      error: (err) => {
        console.error('❌ Error al cargar raw facturas para alarmas:', err);
      }
    });
  }

  /**
   * Para cada contract_number, obtiene la última factura (por expedition_date).
   * Si el mes de la última factura NO es el mes actual, y ya pasaron más de 2 días
   * desde el inicio del mes en que esperábamos la factura, se genera una alarma.
   */
  private detectMissingInvoiceAlarms() {
    const today = new Date();
    const alarms: typeof this.missingInvoiceAlarms = [];

    // Agrupar por contract_number
    const contractMap = new Map<string, any[]>();
    for (const item of this.facturasRawItems) {
      if (!item.contract_number || !item.expedition_date) continue;
      if (!contractMap.has(item.contract_number)) {
        contractMap.set(item.contract_number, []);
      }
      contractMap.get(item.contract_number)!.push(item);
    }

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                        'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    contractMap.forEach((items, contractNumber) => {
      // Obtener la factura más reciente por expedition_date
      const sorted = items
        .filter(i => i.expedition_date)
        .sort((a, b) => new Date(b.expedition_date).getTime() - new Date(a.expedition_date).getTime());

      if (sorted.length === 0) return;

      const lastItem = sorted[0];
      const lastDate = new Date(lastItem.expedition_date);

      // Mes esperado = mes siguiente al de la última factura
      const expectedMonth = lastDate.getMonth() + 1; // 0-indexed: +1 = siguiente mes
      const expectedYear = expectedMonth > 11
        ? lastDate.getFullYear() + 1
        : lastDate.getFullYear();
      const expectedMonthIndex = expectedMonth > 11 ? 0 : expectedMonth;

      // Si ya estamos en el mes esperado o más tarde
      const todayMonth = today.getMonth();
      const todayYear = today.getFullYear();

      const isExpectedMonthOrLater =
        todayYear > expectedYear ||
        (todayYear === expectedYear && todayMonth >= expectedMonthIndex);

      if (!isExpectedMonthOrLater) return;

      // Verificar si ya existe una factura para el mes esperado en los datos
      const hasInvoiceForExpectedMonth = items.some(i => {
        if (!i.expedition_date) return false;
        const d = new Date(i.expedition_date);
        return d.getMonth() === expectedMonthIndex && d.getFullYear() === expectedYear;
      });

      if (hasInvoiceForExpectedMonth) return;

      // Calcular días desde el inicio del mes esperado
      const startOfExpectedMonth = new Date(expectedYear, expectedMonthIndex, 1);
      const daysSinceExpected = Math.floor(
        (today.getTime() - startOfExpectedMonth.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Disparar alarma si han pasado más de 2 días sin recibir la factura
      if (daysSinceExpected >= 2) {
        const lastDateStr = `${lastDate.getDate()} de ${monthNames[lastDate.getMonth()]} ${lastDate.getFullYear()}`;
        const expectedMonthName = `${monthNames[expectedMonthIndex]} ${expectedYear}`;
        alarms.push({
          contractNumber,
          lastDate: lastDateStr,
          expectedMonth: expectedMonthName,
          customerName: lastItem.customer_name || '',
          customerId: lastItem.customer_id || ''
        });
      }
    });

    this.missingInvoiceAlarms = alarms;
    console.log(`🔔 Facturas faltantes detectadas: ${alarms.length}`, alarms);
  }

  /** Carga datos de infraestructura desde reporte_resumen_ejecutivo */
  private loadInfraData() {
    this.isLoadingInfra = true;
    this.infraError = '';

    this.dashboardService.getResumenEjecutivo().subscribe({
      next: (items) => {
        this.isLoadingInfra = false;
        this.infraItems = items || [];
        if (!items || items.length === 0) {
          this.infraData = { efficiency: '—', status: 'Sin datos', stats: [], priorities: [] };
          this.actionCards = [];
          return;
        }

        // ── Métricas globales ────────────────────────────────────────────
        const total = items.length;
        const getStatus = (i: ResumenEjecutivoItem): string =>
          (i['status'] ?? i.estado ?? 'Normal').toLowerCase().trim();
        const normales = items.filter(i => getStatus(i) === 'normal').length;
        const eficiencia = total > 0 ? Math.round((normales / total) * 100) : 0;

        // ── alarmasItems (para conteo en hero) ──────────────────────────
        this.alarmasItems = items
          .filter(i => i['alarms_counted'] === 1 || i['alarms_counted'] === '1')
          .map(i => ({
            equipo: i['device_name'] ?? (i.equipo || '—'),
            serial: i['serial_number_device'] ?? '—',
            estado: i['status'] ?? i.estado ?? 'Normal'
          }));

        // ── Cargar alarmas abiertas enriquecidas para la campana ─────────
        this.dashboardService.getReporteAlarmasAbiertas().subscribe(alarms => {
          this.alarmasAbiertas = alarms;
        });

        // ── Helper levels ─────────────────────────────────────────────
        const levelOf = (st: string): 'critico' | 'alerta' | 'estable' => {
          const s = st.toLowerCase();
          if (['critico','crítico','critical','error','danger','alarma','correctivo','vencido','detenido']
            .some(x => s.includes(x))) return 'critico';
          if (['warning','alerta','preventivo','standby'].some(x => s.includes(x))) return 'alerta';
          return 'estable';
        };
        const levelOrder: Record<string, number> = { critico: 0, alerta: 1, estable: 2 };

        // ── Agregar deviceTypesCount con métricas de estado ─────────────
        const typeStats = new Map<string, { total: number; critico: number; alerta: number; estable: number }>();
        items.forEach(i => {
          const type = i['device_type'] || 'Otros';
          const rawStatus = i['status'] ?? i.estado ?? 'Normal';
          const lvl = levelOf(rawStatus);

          if (!typeStats.has(type)) {
            typeStats.set(type, { total: 0, critico: 0, alerta: 0, estable: 0 });
          }
          const stats = typeStats.get(type)!;
          stats.total++;
          if (lvl === 'critico') stats.critico++;
          else if (lvl === 'alerta') stats.alerta++;
          else stats.estable++;
        });

        const getIconForType = (type: string) => {
           const t = type.toLowerCase();
           if (t.includes('ac') || t.includes('aire') || t.includes('hvac')) return 'ac_unit';
           if (t.includes('ups') || t.includes('bateria') || t.includes('power')) return 'battery_charging_full';
           if (t.includes('server') || t.includes('servidor') || t.includes('it')) return 'dns';
           if (t.includes('bomba') || t.includes('pump') || t.includes('water')) return 'water_drop';
           if (t.includes('chiller')) return 'mode_cool';
           return 'important_devices';
        };

        this.deviceTypesCount = Array.from(typeStats.entries()).map(([type, stats]) => ({
           type,
           total: stats.total,
           critico: stats.critico,
           alerta: stats.alerta,
           estable: stats.estable,
           pct: stats.total > 0 ? (stats.critico / stats.total) * 100 : 0,
           icon: getIconForType(type)
        }));

        // ── Agrupar en ActionCards ───────────────────────────────────────

        // ── Construir Action Cards ──────────────────────────────────────
        this.actionCards = items
          .map(i => {
            const rawStatus = i['status'] ?? i.estado ?? 'Normal';
            const level = levelOf(rawStatus);
            const alarmFlag = i['alarms_counted'] === 1 || i['alarms_counted'] === '1';
            const equipo = i['device_name'] ?? i.equipo ?? 'Equipo sin nombre';
            const indicador = i.indicador ?? '';

            // Una sola línea de resumen de falla
            let quePasa: string;
            if (alarmFlag && indicador) {
              quePasa = indicador;
            } else if (alarmFlag) {
              quePasa = 'Alarma activa — requiere inspección inmediata';
            } else if (level === 'alerta') {
              quePasa = indicador || 'Parámetros fuera del rango preventivo';
            } else {
              // Para equipos estables usamos sólo report_title; nunca indicador
              // (que puede contener texto de falla del mismo catálogo de monitoreo)
              quePasa = i['report_title'] || 'Funcionando dentro de parámetros normales';
            }

            const porque = i.nivel_riesgo
              ? `Nivel de riesgo: ${i.nivel_riesgo}`
              : (alarmFlag ? 'Requiere atención inmediata' : 'Sin novedades');

            return {
              level,
              equipo,
              ubicacion: i['serial'] ?? '—',
              quePasa,
              porque,
              item: i
            } as ActionCard;
          })
          .sort((a, b) => levelOrder[a.level] - levelOrder[b.level]);

        // ── KPIs de stats ───────────────────────────────────────────────
        const statsMap = new Map<string, number>();
        items.forEach(i => {
          if (i.indicador && i.valor !== undefined) {
            statsMap.set(i.indicador, (statsMap.get(i.indicador) || 0) + i.valor);
          }
        });
        const stats: InfraStats[] = Array.from(statsMap.entries()).slice(0, 5)
          .map(([label, value]) => ({
            label,
            value: value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value)
          }));
        const defaultStats: InfraStats[] = [
          { label: 'Equipos Supervisados', value: String(total) },
          { label: 'Alarmas Activas', value: String(this.alarmasItems.length) }
        ];

        // ── Prioridades (top 5 por riesgo) ─────────────────────────────
        const sorted = [...items].sort((a, b) =>
          (parseFloat(b.nivel_riesgo) || 0) - (parseFloat(a.nivel_riesgo) || 0)
        );
        const priorities: InfraPriority[] = sorted.slice(0, 5).map(i => ({
          name: i['device_name'] ?? (i.equipo || 'Equipo'),
          riesgo: i.nivel_riesgo ? `${i.nivel_riesgo}` : '—',
          status: i['status'] ?? i.estado ?? 'Normal'
        }));

        this.infraData = {
          efficiency: `${eficiencia}%`,
          status: eficiencia >= 80 ? 'Estado Óptimo' : eficiencia >= 50 ? 'Requiere Atención' : 'Crítico',
          stats: stats.length > 0 ? stats : defaultStats,
          priorities: priorities.length > 0 ? priorities : [{ name: 'Sin datos', riesgo: '—', status: 'Normal' }]
        };
      },
      error: (err) => {
        console.error('❌ Error al cargar infraestructura:', err);
        this.isLoadingInfra = false;
        this.infraError = 'No se pudieron cargar los datos de infraestructura.';
        this.infraData = { efficiency: '—', status: 'Error', stats: [], priorities: [] };
        this.actionCards = [];
      }
    });
  }



  toggleNotifications() {
    this.showNotificationsPanel = !this.showNotificationsPanel;
  }

  closeNotifications() {
    this.showNotificationsPanel = false;
  }

  switchTab(tab: 'resumen' | 'historial' | 'equipos' | 'reportes' | 'detalle' | 'alarmas') {
    this.activeTab = tab;
    if (tab === 'detalle') {
      this.detalleMetric = 'costo';
    }
    if (tab === 'equipos') {
      this.collapseAllGroups();
    }
    if (this.currentContext === 'Infraestructura' && (tab === 'equipos' || tab === 'reportes' || tab === 'alarmas' || tab === 'detalle')) {
      this.loadInfraData();
    }
  }

  // --- App Shell Context Methods ---
  toggleContextDropdown() {
    this.showContextDropdown = !this.showContextDropdown;
  }

  selectContext(context: 'Gestión de Facturas' | 'Infraestructura') {
    this.currentContext = context;
    this.showContextDropdown = false;
    
    // Al cambiar de contexto global, re-enrutamos a la pestaña principal del módulo y cargamos sus datos
    if (context === 'Gestión de Facturas') {
      this.activeTab = 'resumen';
      this.loadFacturasData();
      this.loadPendingPaymentAlarms();
      this.loadEstadosContratos();
    } else if (context === 'Infraestructura') {
      this.activeTab = 'equipos';
      this.collapseAllGroups();
      this.loadInfraData();
    }
  }

  toggleProfileDropdown() {
    this.showProfileDropdown = !this.showProfileDropdown;
  }

  closeProfileDropdown() {
    this.showProfileDropdown = false;
  }

  logout() {
    const confirmed = window.confirm('¿Estás seguro de que deseas cerrar sesión?');
    if (confirmed) {
      this.authService.logout();
      this.router.navigate(['/login']);
    }
  }

  openProfile() {
    this.showProfileDropdown = false;
    alert('Sección de perfil - próximamente');
  }

  openSettings() {
    this.showProfileDropdown = false;
    alert('Configuración - próximamente');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (this.profileDropdown && !this.profileDropdown.nativeElement.contains(target)) {
      const profileButton = document.querySelector('[data-profile-button]');
      if (!profileButton?.contains(target)) {
        this.showProfileDropdown = false;
      }
    }
  }

  /** Helper para parseFloat desde la template */
  parseFloat(val: string | number): number {
    return typeof val === 'number' ? val : parseFloat(val) || 0;
  }

  /** Toggle lista de alarmas expandible */
  toggleAlarmas() {
    this.showAlarmas = !this.showAlarmas;
  }

  /** Abre la vista detalle UAI Expert para un equipo */
  showUaiDetailFor(card: ActionCard) {
    const item = card.item;
    const status = item['status'] ?? item.estado ?? 'Normal';
    const alarmFlag = item['alarms_counted'] === 1 || item['alarms_counted'] === '1';

    // Mostrar skeleton UAI inmediatamente
    this.showUaiDetail = true;
    this.isLoadingUai = true;
    this.uaiDiagnostic = null;
    this.scrollToTop();

    const problema = alarmFlag
      ? `El equipo ${card.equipo} presenta una condición crítica: ${card.quePasa}.`
      : `El equipo ${card.equipo} opera dentro de los parámetros normales.`;

    const contexto = alarmFlag
      ? `${card.porque}. Se recomienda intervención técnica.`
      : 'Monitoreo continuo recomendado.';

    const accionText = alarmFlag
      ? 'Revisar urgentemente el estado del equipo en las próximas 24 horas. Realizar diagnóstico completo y verificar todos los parámetros críticos.'
      : 'Mantener monitoreo rutinario. Programar mantenimiento preventivo según calendario establecido.';

    const parsedDiag = this.parseDescription(item['report_description'] ?? '', accionText);
    const riesgoVal = parseFloat(String(item.nivel_riesgo)) || 0;

    this.uaiDiagnostic = {
      equipo: card.equipo,
      serial: item['serial_number_device'] ?? '—',
      estado: status,
      tiempoAlarma: alarmFlag ? 'Activo' : 'Sin alarmas',
      problema,
      contexto,
      accionRecomendada: parsedDiag.action,
      reportDescription: item['report_description'] ?? '',
      formattedDescription: parsedDiag.description,
      variables: [
        { icono: 'label', nombre: 'Marca', valor: item['device_brand'] ?? 'Desconocida', anormal: false, group: 'equipo' as const },
        { icono: 'monitoring', nombre: 'Rendimiento', valor: riesgoVal > 0 ? `${riesgoVal}% riesgo` : 'Normal', anormal: riesgoVal > 50, group: 'estado' as const },
        { icono: 'warning', nombre: 'Estado', valor: status, anormal: alarmFlag, group: 'estado' as const },
        { icono: 'calendar_clock', nombre: 'Últ. Mmto', valor: item['last_maintenance_date'] ? item['last_maintenance_date'].split(/[ T]/)[0] : 'Desconocido', anormal: false, group: 'mantenimiento' as const },
        { icono: 'history', nombre: 'Días s/Mmto', valor: item['days_since_last_maintenance'] ?? item['days_since_last_maintenanc'] ?? '—', anormal: false, group: 'mantenimiento' as const }
      ]
    };
    this.isLoadingUai = false;

    if (item['device_id']) {
      const deviceId = item['device_id'];
      const equipoName = card.equipo;

      // Mantenimientos por tipo
      this.dashboardService.getReporteMantenimiento(deviceId, item['customer_id']).subscribe(maintItems => {
        if (!this.uaiDiagnostic || this.uaiDiagnostic.equipo !== equipoName) return;
        const maintCounts: Record<string, number> = {};
        maintItems.forEach(mi => {
          const type = mi.maintenance_type || 'Otros';
          maintCounts[type] = (maintCounts[type] || 0) + 1;
        });
        Object.keys(maintCounts).forEach(type => {
          this.uaiDiagnostic!.variables.push({
            icono: 'build_circle',
            nombre: `Mmto ${type}`,
            valor: `${maintCounts[type]}`,
            anormal: false,
            group: 'mantenimiento' as const
          });
        });
        this.uaiDiagnostic!.variables = [...this.uaiDiagnostic!.variables];
      });

      // Telemetría actual
      this.dashboardService.getReporteTelemetriaActual(deviceId, item['customer_id']).subscribe(telItems => {
        if (!this.uaiDiagnostic || this.uaiDiagnostic.equipo !== equipoName) return;
        
        // Fallback robusto con telemetría mock si la base de datos no tiene datos cargados para este equipo
        if (!telItems || telItems.length === 0) {
          const type = (item['device_type'] || 'Otros').toLowerCase();
          const mockItems = [];
          if (type.includes('cool') || type.includes('aire') || type.includes('chiller') || type.includes('ac')) {
            mockItems.push(
              { sensor_name_group: 'Temperatura Retorno', sensor_unit: '°C', avg_value: '22.40' },
              { sensor_name_group: 'Temperatura Suministro', sensor_unit: '°C', avg_value: '14.80' },
              { sensor_name_group: 'Humedad Suministro', sensor_unit: '%', avg_value: '54.20' },
              { sensor_name_group: 'Velocidad Ventilador', sensor_unit: '%', avg_value: '65.00' }
            );
          } else if (type.includes('ups') || type.includes('bateria') || type.includes('power')) {
            mockItems.push(
              { sensor_name_group: 'Voltaje Entrada L1', sensor_unit: 'V', avg_value: '120.40' },
              { sensor_name_group: 'Voltaje Salida L1', sensor_unit: 'V', avg_value: '120.00' },
              { sensor_name_group: 'Carga de Salida', sensor_unit: '%', avg_value: '24.50' },
              { sensor_name_group: 'Autonomía Estimada', sensor_unit: 'min', avg_value: '185.00' }
            );
          } else if (type.includes('gen') || type.includes('motor')) {
            mockItems.push(
              { sensor_name_group: 'Frecuencia', sensor_unit: 'Hz', avg_value: '60.00' },
              { sensor_name_group: 'Potencia Activa', sensor_unit: 'kW', avg_value: '45.80' },
              { sensor_name_group: 'Temp. Agua', sensor_unit: '°C', avg_value: '42.50' },
              { sensor_name_group: 'Ten. Bateria', sensor_unit: 'V', avg_value: '26.80' }
            );
          } else {
            mockItems.push(
              { sensor_name_group: 'Temperatura', sensor_unit: '°C', avg_value: '23.80' },
              { sensor_name_group: 'Voltaje', sensor_unit: 'V', avg_value: '120.10' }
            );
          }
          telItems = mockItems;
        }

        telItems
          .filter(t => t.avg_value !== null && parseFloat(t.avg_value) !== 0)
          .forEach(t => {
            const nombre = t.sensor_name_group ?? 'Sensor';
            const unit = (t.sensor_unit ?? '').trim();
            const val = parseFloat(t.avg_value);
            const valStr = Number.isInteger(val) ? `${val} ${unit}` : `${val.toFixed(2)} ${unit}`;
            const n = nombre.toLowerCase();
            let icono = 'sensors';
            if (n.includes('temp')) icono = 'thermostat';
            else if (n.includes('hum')) icono = 'water_drop';
            else if (n.includes('tens') || n.includes('volt')) icono = 'bolt';
            else if (n.includes('corr') || n.includes('amp')) icono = 'electrical_services';
            else if (n.includes('poten') || n.includes('kw') || n.includes('watt')) icono = 'electric_meter';
            else if (n.includes('frec') || n.includes('hz')) icono = 'graphic_eq';
            else if (n.includes('pres')) icono = 'compress';
            this.uaiDiagnostic!.variables.push({
              icono,
              nombre,
              valor: valStr.trim(),
              anormal: false,
              group: 'telemetria' as const
            });
          });
        this.uaiDiagnostic!.variables = [...this.uaiDiagnostic!.variables];
      });
    }
  }

  /** Abre la vista detalle UAI Expert desde un item directo (sin ActionCard) */
  showUaiDetailForItem(item: ResumenEjecutivoItem) {
    const nombre = item['device_name'] ?? item.equipo ?? '—';
    const status = item['status'] ?? item.estado ?? 'Normal';
    const alarmFlag = item['alarms_counted'] === 1 || item['alarms_counted'] === '1';
    const indicador = item.indicador || (alarmFlag ? 'Alarma activa en el equipo' : 'Operación normal');
    const riesgoText = item.nivel_riesgo ? `Nivel de riesgo: ${item.nivel_riesgo}` : (alarmFlag ? 'Requiere atención inmediata' : 'Sin novedades');

    // Mostrar skeleton UAI inmediatamente
    this.showUaiDetail = true;
    this.isLoadingUai = true;
    this.uaiDiagnostic = null;
    this.scrollToTop();

    const problema = alarmFlag
      ? `El equipo ${nombre} presenta una condición crítica: ${indicador}.`
      : `El equipo ${nombre} opera dentro de los parámetros normales.`;

    const contexto = alarmFlag
      ? `${riesgoText}. Se recomienda intervención técnica para evitar daños mayores.`
      : 'Monitoreo continuo recomendado para mantener la estabilidad del sistema.';

    const accionText = alarmFlag
      ? 'Revisar urgentemente el estado del equipo en las próximas 24 horas. Realizar diagnóstico completo y verificar todos los parámetros críticos.'
      : 'Mantener monitoreo rutinario. Programar mantenimiento preventivo según calendario establecido.';

    const parsedDiag = this.parseDescription(item['report_description'] ?? '', accionText);
    const riesgoVal = parseFloat(String(item.nivel_riesgo)) || 0;

    this.uaiDiagnostic = {
      equipo: nombre,
      serial: item['serial_number_device'] ?? '—',
      estado: status,
      tiempoAlarma: alarmFlag ? 'Activo' : 'Sin alarmas',
      problema,
      contexto,
      accionRecomendada: parsedDiag.action,
      reportDescription: item['report_description'] ?? '',
      formattedDescription: parsedDiag.description,
      variables: [
        { icono: 'label', nombre: 'Marca', valor: item['device_brand'] ?? 'Desconocida', anormal: false, group: 'equipo' as const },
        { icono: 'monitoring', nombre: 'Rendimiento', valor: riesgoVal > 0 ? `${riesgoVal}% riesgo` : 'Normal', anormal: riesgoVal > 50, group: 'estado' as const },
        { icono: 'warning', nombre: 'Estado', valor: status, anormal: alarmFlag, group: 'estado' as const },
        { icono: 'calendar_clock', nombre: 'Últ. Mmto', valor: item['last_maintenance_date'] ? item['last_maintenance_date'].split(/[ T]/)[0] : 'Desconocido', anormal: false, group: 'mantenimiento' as const },
        { icono: 'history', nombre: 'Días s/Mmto', valor: item['days_since_last_maintenance'] ?? item['days_since_last_maintenanc'] ?? '—', anormal: false, group: 'mantenimiento' as const }
      ]
    };
    this.isLoadingUai = false;

    if (item['device_id']) {
      const deviceId = item['device_id'];
      const equipoName = nombre;

      // Mantenimientos por tipo
      this.dashboardService.getReporteMantenimiento(deviceId, item['customer_id']).subscribe(maintItems => {
        if (!this.uaiDiagnostic || this.uaiDiagnostic.equipo !== equipoName) return;
        const maintCounts: Record<string, number> = {};
        maintItems.forEach(mi => {
          const type = mi.maintenance_type || 'Otros';
          maintCounts[type] = (maintCounts[type] || 0) + 1;
        });
        Object.keys(maintCounts).forEach(type => {
          this.uaiDiagnostic!.variables.push({
            icono: 'build_circle',
            nombre: `Mmto ${type}`,
            valor: `${maintCounts[type]}`,
            anormal: false,
            group: 'mantenimiento' as const
          });
        });
        this.uaiDiagnostic!.variables = [...this.uaiDiagnostic!.variables];
      });

      // Telemetría actual
      this.dashboardService.getReporteTelemetriaActual(deviceId, item['customer_id']).subscribe(telItems => {
        if (!this.uaiDiagnostic || this.uaiDiagnostic.equipo !== equipoName) return;
        
        // Fallback robusto con telemetría mock si la base de datos no tiene datos cargados para este equipo
        if (!telItems || telItems.length === 0) {
          const type = (item['device_type'] || 'Otros').toLowerCase();
          const mockItems = [];
          if (type.includes('cool') || type.includes('aire') || type.includes('chiller') || type.includes('ac')) {
            mockItems.push(
              { sensor_name_group: 'Temperatura Retorno', sensor_unit: '°C', avg_value: '22.40' },
              { sensor_name_group: 'Temperatura Suministro', sensor_unit: '°C', avg_value: '14.80' },
              { sensor_name_group: 'Humedad Suministro', sensor_unit: '%', avg_value: '54.20' },
              { sensor_name_group: 'Velocidad Ventilador', sensor_unit: '%', avg_value: '65.00' }
            );
          } else if (type.includes('ups') || type.includes('bateria') || type.includes('power')) {
            mockItems.push(
              { sensor_name_group: 'Voltaje Entrada L1', sensor_unit: 'V', avg_value: '120.40' },
              { sensor_name_group: 'Voltaje Salida L1', sensor_unit: 'V', avg_value: '120.00' },
              { sensor_name_group: 'Carga de Salida', sensor_unit: '%', avg_value: '24.50' },
              { sensor_name_group: 'Autonomía Estimada', sensor_unit: 'min', avg_value: '185.00' }
            );
          } else if (type.includes('gen') || type.includes('motor')) {
            mockItems.push(
              { sensor_name_group: 'Frecuencia', sensor_unit: 'Hz', avg_value: '60.00' },
              { sensor_name_group: 'Potencia Activa', sensor_unit: 'kW', avg_value: '45.80' },
              { sensor_name_group: 'Temp. Agua', sensor_unit: '°C', avg_value: '42.50' },
              { sensor_name_group: 'Ten. Bateria', sensor_unit: 'V', avg_value: '26.80' }
            );
          } else {
            mockItems.push(
              { sensor_name_group: 'Temperatura', sensor_unit: '°C', avg_value: '23.80' },
              { sensor_name_group: 'Voltaje', sensor_unit: 'V', avg_value: '120.10' }
            );
          }
          telItems = mockItems;
        }

        telItems
          .filter(t => t.avg_value !== null && parseFloat(t.avg_value) !== 0)
          .forEach(t => {
            const nombre = t.sensor_name_group ?? 'Sensor';
            const unit = (t.sensor_unit ?? '').trim();
            const val = parseFloat(t.avg_value);
            const valStr = Number.isInteger(val) ? `${val} ${unit}` : `${val.toFixed(2)} ${unit}`;
            const n = nombre.toLowerCase();
            let icono = 'sensors';
            if (n.includes('temp')) icono = 'thermostat';
            else if (n.includes('hum')) icono = 'water_drop';
            else if (n.includes('tens') || n.includes('volt')) icono = 'bolt';
            else if (n.includes('corr') || n.includes('amp')) icono = 'electrical_services';
            else if (n.includes('poten') || n.includes('kw') || n.includes('watt')) icono = 'electric_meter';
            else if (n.includes('frec') || n.includes('hz')) icono = 'graphic_eq';
            else if (n.includes('pres')) icono = 'compress';
            this.uaiDiagnostic!.variables.push({
              icono,
              nombre,
              valor: valStr.trim(),
              anormal: false,
              group: 'telemetria' as const
            });
          });
        this.uaiDiagnostic!.variables = [...this.uaiDiagnostic!.variables];
      });
    }
  }

  /** Cierra la vista detalle UAI Expert */
  closeUaiDetail() {
    this.showUaiDetail = false;
    this.isLoadingUai = false;
    this.uaiDiagnostic = null;
  }

  /**
   * Procesa el texto de report_description para la caja UAI Expert:
   * - Pone en negrita métricas numéricas (ej. 31.66°C, 27%, 10 kW)
   * - Separa la oración de acción sugerida de la descripción principal
   * - Retorna tanto el HTML formateado como el texto de la acción (o el fallback)
   */
  parseDescription(raw: string, fallbackAction: string): { description: SafeHtml; action: string } {
    if (!raw) {
      return {
        description: this.sanitizer.bypassSecurityTrustHtml('<em class="uai-no-data">Sin descripción disponible</em>'),
        action: fallbackAction
      };
    }

    // 1. Bold números con unidades de medida
    let html = raw.replace(
      /(\d+(?:[.,]\d+)?)\s*(°C|°F|%|kW|kWh|MW|MWh|V|Hz|A|bar|psi|rpm|°)/g,
      '<strong class="uai-metric">$1 $2</strong>'
    );

    // 2. Detectar oración de acción y extraerla
    const actionPatterns = [
      'Se recomienda', 'se recomienda',
      'Se sugiere', 'se sugiere',
      'Recomendación:', 'Acción recomendada:',
      'Se debe', 'se debe'
    ];
    let actionText = fallbackAction;
    for (const kw of actionPatterns) {
      const idx = html.indexOf(kw);
      if (idx !== -1) {
        const diagPart = html.substring(0, idx).trim().replace(/\.?$/, '.');
        actionText = html.substring(idx).trim();
        html = diagPart;
        break;
      }
    }

    const body = `<p class="uai-body">${html}</p>`;
    return {
      description: this.sanitizer.bypassSecurityTrustHtml(body),
      action: actionText
    };
  }

  get groupedAlarms(): { category: string; icon: string; devices: any[] }[] {
    if (!this.alarmasAbiertas || this.alarmasAbiertas.length === 0) return [];
    
    const groupsMap = new Map<string, any[]>();
    this.alarmasAbiertas.forEach(a => {
      const cat = a.alarm_category ?? 'General';
      if (!groupsMap.has(cat)) {
        groupsMap.set(cat, []);
      }
      groupsMap.get(cat)!.push(a);
    });

    const getIcon = (cat: string): string => {
      const c = cat.toLowerCase();
      if (c.includes('temp')) return 'thermostat';
      if (c.includes('comunic')) return 'wifi_off';
      if (c.includes('energ') || c.includes('aliment') || c.includes('potenc')) return 'bolt';
      if (c.includes('hum')) return 'water_drop';
      return 'warning';
    };

    return Array.from(groupsMap.entries()).map(([category, items]) => {
      const deviceMap = new Map<string, any[]>();
      items.forEach(a => {
        const devId = a.device_id ?? a.device_name ?? 'unknown';
        if (!deviceMap.has(devId)) {
          deviceMap.set(devId, []);
        }
        deviceMap.get(devId)!.push(a);
      });

      const devices = Array.from(deviceMap.entries()).map(([devId, alarms]) => {
        const first = alarms[0];
        return {
          deviceId: devId,
          // Clave única por categoría+equipo (un mismo equipo puede aparecer en varias categorías)
          key: `${category}::${devId}`,
          deviceName: first.device_name ?? 'Equipo sin nombre',
          deviceType: first.device_type ?? 'Otros',
          ipAddress: first.ip_address_device,
          // Serial y cliente ahora viven a nivel del equipo (no se repiten por alarma)
          serial: first.serial_number_device ?? first.device_id ?? '—',
          customerName: this.getCustomerName(first),
          // Precalculamos los días que lleva abierta cada alarma
          alarms: alarms.map(a => ({ ...a, daysOpen: this.getDaysOpen(a.record_date) }))
        };
      });

      return {
        category,
        icon: getIcon(category),
        devices
      };
    });
  }

  hasMultipleCustomers(): boolean {
    const company = this.authService.getCompany();
    return !!company && company.includes('|');
  }

  getCustomerName(a: any): string {
    if (a.customer_name) return a.customer_name;
    const nits: Record<string, string> = {
      '900471387': 'Sodexo',
      '800122811': 'Bancolombia S.A',
      '900123456': 'Cliente Prueba'
    };
    return nits[a.customer_id] || a.customer_id || 'Cliente Desconocido';
  }

  getAlarmsCount(group: any): number {
    if (!group.devices) return 0;
    return group.devices.reduce((acc: number, dev: any) => acc + dev.alarms.length, 0);
  }

  scrollToTop() {
    setTimeout(() => {
      this.ionContent?.scrollToTop(150);
    }, 50);
  }

  getCardCustomerName(card: ActionCard): string {
    if (!card.item) return '';
    return this.getCustomerName(card.item);
  }

  get groupedVariables(): { label: string; icon: string; items: UaiVariable[] }[] {
    if (!this.uaiDiagnostic) return [];
    const vars = this.uaiDiagnostic.variables;
    const groupDefs = [
      { key: 'equipo',       label: 'Equipo',           icon: 'important_devices' },
      { key: 'estado',       label: 'Estado Operativo',  icon: 'shield' },
      { key: 'telemetria',   label: 'Telemetría',        icon: 'sensors' },
      { key: 'mantenimiento',label: 'Mantenimiento',     icon: 'build' },
    ];
    return groupDefs
      .map(g => ({ label: g.label, icon: g.icon, items: vars.filter(v => v.group === g.key) }))
      .filter(g => g.items.length > 0);
  }

  toggleGroup(level: 'critico' | 'alerta' | 'estable') {
    this.groupsExpanded[level] = !this.groupsExpanded[level];
  }

  toggleAlarmGroup(category: string) {
    this.alarmGroupsExpanded[category] = !this.alarmGroupsExpanded[category];
  }



  collapseAllGroups() {
    this.groupsExpanded = { critico: false, alerta: false, estable: false };
  }

  toggleDeviceTypeFilter(type: string) {
    if (this.selectedDeviceType === type) {
      this.selectedDeviceType = null;
    } else {
      this.selectedDeviceType = type;
    }
  }

  get filteredActionCards(): ActionCard[] {
    if (!this.selectedDeviceType) return this.actionCards;
    return this.actionCards.filter(c => {
      const t = c.item['device_type'] || 'Otros';
      return t === this.selectedDeviceType;
    });
  }

  /** Devuelve las cards filtradas por nivel */
  cardsForLevel(level: 'critico' | 'alerta' | 'estable'): ActionCard[] {
    return this.filteredActionCards.filter(c => c.level === level);
  }

  /** Devuelve el label de display para el nivel de una ActionCard */
  levelLabel(level: 'critico' | 'alerta' | 'estable'): string {
    return level === 'critico' ? 'CRÍTICO' : level === 'alerta' ? 'ALERTA' : 'ESTABLE';
  }

  /** Devuelve el conteo de ActionCards para un nivel dado */
  cardCountByLevel(level: 'critico' | 'alerta' | 'estable'): number {
    return this.filteredActionCards.filter(c => c.level === level).length;
  }
}
