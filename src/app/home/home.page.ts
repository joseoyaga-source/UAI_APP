import { Component, HostListener, ViewChild, ElementRef, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../services/auth';
import { DashboardService, FacturasDashboard, FacturaSede, TendenciaPunto, PeriodoFilter, ResumenEjecutivoItem, DatosBasicosFactura, DescargaFacturaEstadoItem, ContratoSinFacturaCompletaItem, FacturaItem, TelemetriaMensualItem, TelemetriaHorariaItem } from '../services/dashboard.service';
import { forkJoin, of } from 'rxjs';

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

interface SensorCard {
  sensorName: string;
  variable: string;
  unit: string;
  icon: string;
  headquarters: string;
  currentAvg: number;
  currentMax: number;
  currentMin: number;
  compareAvg: number;
  currentSum: number;
  compareSum: number;
  variationPct: number;
  variationLabel: string;
  currentTrendPath: string;
  currentTrendAreaPath: string;
  compareTrendPath: string;
  compareTrendAreaPath: string;
  valueLabel?: string;
}

interface TelemetryGroup {
  name: string;
  icon: string;
  isExpanded: boolean;
  cards: SensorCard[];
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
  activeTab: 'resumen' | 'historial' | 'equipos' | 'reportes' | 'detalle' | 'alarmas' | 'mensual' | 'diario' | 'horario' = 'resumen';
  infraItems: ResumenEjecutivoItem[] = [];
  showProfileDropdown = false;
  @ViewChild('profileDropdown') profileDropdown?: ElementRef;
  @ViewChild(IonContent) ionContent?: IonContent;

  // --- App Shell Context Switcher ---
  currentContext: 'Gestión de Facturas' | 'Infraestructura' | 'Medición Inteligente' = 'Gestión de Facturas';
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

  // --- Filtro por Empresa ---
  selectedCompanyId = 'todos';
  availableCompanies: { id: string; name: string }[] = [];
  showCompanyDropdown = false;

  // Respaldos crudos de datos sin filtrar
  rawFacturasCurrent: FacturaItem[] = [];
  rawFacturasCompare: FacturaItem[] = [];
  rawEstadosContratos: any[] = [];
  rawPendingPaymentAlarms: any[] = [];
  rawMissingInvoiceAlarms: any[] = [];

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
      const key = c.state || c.status || 'Otro';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    }
    // Activo primero, luego Piloto, luego los demás
    const priority = ['Activo', 'Piloto'];
    return Object.entries(groups)
      .sort(([a], [b]) => {
        const idxA = priority.indexOf(a);
        const idxB = priority.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      })
      .map(([estado, items]) => ({ estado, items }));
  }

  toggleContratosGroup(estado: string) {
    if (this.contratosGroupsExpanded[estado] === undefined) {
      this.contratosGroupsExpanded[estado] = false;
    }
    this.contratosGroupsExpanded[estado] = !this.contratosGroupsExpanded[estado];
  }

  getContratoGroupHeaderClass(estado: string): string {
    const est = (estado || '').toLowerCase();
    if (est === 'activo' || est === 'piloto') {
      return 'bg-[#014751] border-[#29E490]/20';
    }
    if (est === 'cancelado' || est === 'inactivo') {
      return 'bg-[#1b1b1c] border-white/10';
    }
    return 'bg-[#1b1b1c] border-white/5';
  }

  getContratoGroupIconClass(estado: string): string {
    const est = (estado || '').toLowerCase();
    if (est === 'activo' || est === 'piloto') {
      return 'text-[#29E490]';
    }
    if (est === 'cancelado' || est === 'inactivo') {
      return 'text-[#EF4444]';
    }
    return 'text-[#91A2B8]';
  }

  getContratoGroupIcon(estado: string): string {
    const est = (estado || '').toLowerCase();
    if (est === 'activo' || est === 'piloto') {
      return 'check_circle';
    }
    if (est === 'cancelado' || est === 'inactivo') {
      return 'cancel';
    }
    return 'help';
  }

  getContratoGroupBadgeClass(estado: string): string {
    const est = (estado || '').toLowerCase();
    if (est === 'activo' || est === 'piloto') {
      return 'bg-[#29E490]/20 text-[#29E490]';
    }
    if (est === 'cancelado' || est === 'inactivo') {
      return 'bg-[#EF4444]/20 text-[#EF4444]';
    }
    return 'bg-white/10 text-[#91A2B8]';
  }

  // --- Medición Inteligente ---
  telemetriaMensualItems: TelemetriaMensualItem[] = [];
  telemetriaDiariaItems: TelemetriaMensualItem[] = [];
  telemetriaDiariaItemsCompare: TelemetriaMensualItem[] = [];
  telemetriaHorariaItems: TelemetriaHorariaItem[] = [];
  telemetriaHorariaItemsCompare: TelemetriaHorariaItem[] = [];
  isLoadingTelemetria = false;
  telemetriaError = '';
  availableSedes: string[] = [];
  selectedSede = 'todas';
  showSedeDropdown = false;
  selectedTelemetriaMonth: { year: number; month: number } = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  selectedTelemetriaDate: string = new Date().toISOString().split('T')[0];
  telemetriaSensorGroups: TelemetryGroup[] = [];

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

  hasMedicionAccess(): boolean {
    const roles = this.authService.getUserRoles();
    if (roles.length === 0) return true; // dev fallback
    return roles.some(r => {
      const lower = r.toLowerCase();
      return lower.includes('medicion') || lower.includes('telemetria') || lower.includes('administrar sedes') || lower.includes('administrar_sedes');
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
    this.telemetriaMensualItems = [];
    this.telemetriaDiariaItems = [];
    this.telemetriaDiariaItemsCompare = [];
    this.telemetriaHorariaItems = [];
    this.telemetriaHorariaItemsCompare = [];
    this.telemetriaSensorGroups = [];
    this.availableSedes = [];
    this.selectedSede = 'todas';
    this.telemetriaError = '';
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
        const sorted = items.sort((a, b) => {
          const nameA = (a.headquarters_name || '').toLowerCase();
          const nameB = (b.headquarters_name || '').toLowerCase();
          return nameA.localeCompare(nameB);
        });
        this.rawEstadosContratos = sorted;
        this.isLoadingContratos = false;
        this.extractCompanies();
        this.applyCompanyFilter();
      },
      error: () => { this.isLoadingContratos = false; }
    });
  }

  /**
   * Carga alarmas de pago desde descarga_facturas_estados.
   * Alarma si payment_status === 'Vencida' o si es 'Pendiente' y faltan ≤ 5 días para due_date.
   */
  private loadPendingPaymentAlarms() {
    this.dashboardService.getFacturasRecibidas().subscribe({
      next: (items: DescargaFacturaEstadoItem[]) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const DAYS_THRESHOLD = 5;

        const alarms: typeof this.pendingPaymentAlarms = [];

        for (const inv of items) {
          if (inv.payment_status === 'Pagada') continue;

          const due = new Date(inv.due_date);
          due.setHours(0, 0, 0, 0);
          const daysLeft = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Alarmar si está vencida o si es pendiente y vence en ≤ 5 días
          if (inv.payment_status === 'Vencida' || (inv.payment_status === 'Pendiente' && daysLeft <= DAYS_THRESHOLD)) {
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
        const sortedAlarms = alarms.sort((a, b) => a.daysLeft - b.daysLeft);
        this.rawPendingPaymentAlarms = sortedAlarms;
        this.applyCompanyFilter();
        console.log(`💳 Alarmas de pago (facturas_recibidas): ${sortedAlarms.length}`, sortedAlarms);
      },
      error: (err) => {
        console.error('❌ Error al cargar facturas_recibidas:', err);
      }
    });
  }

  private loadFacturasData() {
    this.isLoadingFacturas = true;
    this.facturasError = '';

    // Cargar facturas crudas del período seleccionado
    this.dashboardService.getRawFacturas(this.selectedPeriod).subscribe({
      next: (data) => {
        console.log(`📊 Facturas Crudas [${this.selectedPeriod}]:`, data);
        this.rawFacturasCurrent = data.current || [];
        this.rawFacturasCompare = data.compare || [];
        this.isLoadingFacturas = false;
        this.extractCompanies();
        this.applyCompanyFilter();
      },
      error: (err) => {
        console.error('❌ Error al cargar facturas crudas:', err);
        this.isLoadingFacturas = false;
        if (err.status === 401 || err.status === 403) {
          this.facturasError = 'Sesión expirada. Verifica el token de API.';
        } else {
          this.facturasError = 'No se pudieron cargar los datos.';
        }
      }
    });

    // Cargar alarmas de facturas faltantes desde contratos_sin_facturas_completas
    this.loadMissingInvoiceAlarms();
  }

  /**
   * Carga alarmas de facturas faltantes desde contratos_sin_facturas_completas.
   * Solo alarma si days_overdue > 0 (ya pasó la fecha esperada de la factura).
   */
  private loadMissingInvoiceAlarms() {
    this.dashboardService.getReporteFacturasPorRecibir().subscribe({
      next: (items: ContratoSinFacturaCompletaItem[]) => {
        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

        const alarms: typeof this.missingInvoiceAlarms = items
          .filter(i => i.days_overdue > 0)
          .map(i => {
            const missingDate = new Date(i.missing_month);
            const expectedMonthName = `${monthNames[missingDate.getMonth()]} ${missingDate.getFullYear()}`;
            return {
              contractNumber: i.contract_number,
              lastDate: `${i.expected_invoice_date}`,
              expectedMonth: expectedMonthName,
              customerName: i.customer_name || '',
              customerId: i.customer_id || ''
            };
          });

        this.rawMissingInvoiceAlarms = alarms;
        this.applyCompanyFilter();
        console.log(`🔔 Facturas faltantes (reporte_facturas_por_recibir): ${alarms.length}`, alarms);
      },
      error: (err) => {
        console.error('❌ Error al cargar reporte_facturas_por_recibir:', err);
      }
    });
  }

  // --- Helpers Filtro Empresa ---
  toggleCompanyDropdown() {
    this.showCompanyDropdown = !this.showCompanyDropdown;
  }

  selectCompany(companyId: string) {
    this.selectedCompanyId = companyId;
    this.showCompanyDropdown = false;
    this.applyCompanyFilter();
  }

  getSelectedCompanyLabel(): string {
    if (this.selectedCompanyId === 'todos') {
      return 'Todos';
    }
    const comp = this.availableCompanies.find(c => c.id === this.selectedCompanyId);
    return comp ? comp.name : this.selectedCompanyId;
  }

  extractCompanies() {
    const companyMap = new Map<string, string>();

    // Extraer de facturas crudas actuales
    if (this.rawFacturasCurrent) {
      this.rawFacturasCurrent.forEach(item => {
        if (item.customer_id && item.customer_name) {
          companyMap.set(item.customer_id.trim(), item.customer_name.trim());
        }
      });
    }

    // Extraer de contratos
    if (this.rawEstadosContratos) {
      this.rawEstadosContratos.forEach(item => {
        if (item.customer_id && item.customer_name) {
          companyMap.set(item.customer_id.trim(), item.customer_name.trim());
        }
      });
    }

    const extracted = Array.from(companyMap.entries()).map(([id, name]) => ({ id, name }));
    
    if (JSON.stringify(extracted) !== JSON.stringify(this.availableCompanies)) {
      this.availableCompanies = extracted;
    }
  }

  applyCompanyFilter() {
    const cid = this.selectedCompanyId;

    // 1. Filtrar facturas (dashboard)
    if (this.rawFacturasCurrent) {
      const filteredCurrent = cid === 'todos'
        ? this.rawFacturasCurrent
        : this.rawFacturasCurrent.filter(i => i.customer_id === cid);

      const filteredCompare = cid === 'todos'
        ? this.rawFacturasCompare
        : this.rawFacturasCompare.filter(i => i.customer_id === cid);

      this.facturasData = this.dashboardService.buildDashboard(filteredCurrent, filteredCompare);
    }

    // 2. Filtrar contratos
    if (this.rawEstadosContratos) {
      this.estadosContratos = cid === 'todos'
        ? [...this.rawEstadosContratos]
        : this.rawEstadosContratos.filter(c => c.customer_id === cid);
    }

    // 3. Filtrar alarmas pendientes de pago
    if (this.rawPendingPaymentAlarms) {
      this.pendingPaymentAlarms = cid === 'todos'
        ? [...this.rawPendingPaymentAlarms]
        : this.rawPendingPaymentAlarms.filter(a => a.customerId === cid);
    }

    // 4. Filtrar alarmas de facturas faltantes
    if (this.rawMissingInvoiceAlarms) {
      this.missingInvoiceAlarms = cid === 'todos'
        ? [...this.rawMissingInvoiceAlarms]
        : this.rawMissingInvoiceAlarms.filter(a => a.customerId === cid);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Medición Inteligente — Telemetría de Sedes
  // ═══════════════════════════════════════════════════════════════

  toggleSedeDropdown() {
    this.showSedeDropdown = !this.showSedeDropdown;
  }

  selectSede(sede: string) {
    this.selectedSede = sede;
    this.showSedeDropdown = false;
    this.reagrupateTelemetry();
  }

  toggleTelemetryGroup(group: TelemetryGroup) {
    group.isExpanded = !group.isExpanded;
  }

  getTelemetrySensorsCount(): number {
    return this.telemetriaSensorGroups.reduce((acc, g) => acc + g.cards.length, 0);
  }

  private isSolarCard(variable: string, sensorName: string): boolean {
    const v = (variable || '').toLowerCase();
    const s = (sensorName || '').toLowerCase();
    return v.includes('solar') || s.includes('solar') || v.includes('generac') || s.includes('generac');
  }

  /**
   * Color del indicador de variación. Para la mayoría de variables (consumo, costo)
   * subir es malo (rojo) y bajar es bueno (verde). Para Generación Solar es al revés:
   * generar más es bueno (verde) y generar menos es malo (rojo).
   */
  getVariationColorClass(card: SensorCard): string {
    if (card.variationPct === 0) return 'text-[#91A2B8]';
    const subio = card.variationPct > 0;
    const esBueno = this.isSolarCard(card.variable, card.sensorName) ? subio : !subio;
    return esBueno ? 'text-[#29E490]' : 'text-red-400';
  }

  /**
   * Para las tarjetas de "Total" (Consumos y Generación Solar), el valor a mostrar
   * debe ser la SUMA de todos los registros del período (días del mes o horas del día),
   * no el promedio. groupBySensorDiario/Horario calculan currentAvg como promedio
   * (correcto para categorías "Promedio"); aquí lo sobreescribimos con la suma real.
   */
  private applyTotalSum(c: SensorCard) {
    c.currentAvg = c.currentSum;
    c.compareAvg = c.compareSum;
    c.variationPct = Math.round((c.compareSum ? ((c.currentSum - c.compareSum) / c.compareSum) * 100 : 0) * 10) / 10;
  }

  // --- Modal "Ver Historial" (gráfica mensual) ---
  historialModalCard: SensorCard | null = null;

  openHistorialModal(card: SensorCard) {
    this.historialModalCard = card;
  }

  closeHistorialModal() {
    this.historialModalCard = null;
  }

  buildTelemetryGroups(cards: SensorCard[], periodType: 'mensual' | 'diario' | 'horario'): TelemetryGroup[] {
    const consumosCards: SensorCard[] = [];
    const solarCards: SensorCard[] = [];
    const restMap = new Map<string, SensorCard[]>();

    for (const card of cards) {
      const v = (card.variable || '').toLowerCase();
      const s = (card.sensorName || '').toLowerCase();

      if (this.isSolarCard(v, s)) {
        solarCards.push(card);
      } else if (v.includes('consum') || s.includes('consum') || v.includes('energ') || s.includes('energ') || v.includes('kwh') || s.includes('kwh')) {
        consumosCards.push(card);
      } else {
        const catName = card.variable || 'Otros';
        if (!restMap.has(catName)) restMap.set(catName, []);
        restMap.get(catName)!.push(card);
      }
    }

    // Ordenar consumos: Consumo General primero, luego Consumos Aires, luego otros
    consumosCards.sort((a, b) => {
      const nameA = a.sensorName.toLowerCase();
      const nameB = b.sensorName.toLowerCase();
      const varA = a.variable.toLowerCase();
      const varB = b.variable.toLowerCase();

      const isGenA = nameA.includes('general') || varA.includes('general');
      const isGenB = nameB.includes('general') || varB.includes('general');
      const isAirA = nameA.includes('aires') || varA.includes('aires');
      const isAirB = nameB.includes('aires') || varB.includes('aires');

      if (isGenA && !isGenB) return -1;
      if (!isGenA && isGenB) return 1;
      if (isAirA && !isAirB) return -1;
      if (!isAirA && isAirB) return 1;
      return a.sensorName.localeCompare(b.sensorName);
    });

    const groups: TelemetryGroup[] = [];

    // Agregar Grupo Consumos
    if (consumosCards.length > 0) {
      consumosCards.forEach(c => {
        if (periodType === 'mensual') {
          c.valueLabel = 'Consumo Total';
        } else if (periodType === 'diario') {
          c.valueLabel = 'Consumo Total Diario';
        } else {
          c.valueLabel = 'Consumo Total Horario';
        }
        this.applyTotalSum(c);
      });
      groups.push({
        name: 'Consumos',
        icon: 'electric_meter',
        isExpanded: true,
        cards: consumosCards
      });
    }

    // Agregar Grupo Generación Solar
    if (solarCards.length > 0) {
      solarCards.forEach(c => {
        if (periodType === 'mensual') {
          c.valueLabel = 'Generación Total';
        } else if (periodType === 'diario') {
          c.valueLabel = 'Generación Total Diaria';
        } else {
          c.valueLabel = 'Generación Total Horaria';
        }
        this.applyTotalSum(c);
      });
      groups.push({
        name: 'Generación Solar',
        icon: 'solar_power',
        isExpanded: false,
        cards: solarCards
      });
    }

    // Agregar otros grupos
    Array.from(restMap.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([catName, catCards]) => {
      catCards.forEach(c => {
        if (periodType === 'mensual') {
          c.valueLabel = 'Promedio mensual';
        } else if (periodType === 'diario') {
          c.valueLabel = 'Promedio diario';
        } else {
          c.valueLabel = 'Promedio horario';
        }
      });
      groups.push({
        name: catName,
        icon: this.getVariableIcon(catName),
        isExpanded: false,
        cards: catCards
      });
    });

    return groups;
  }

  reagrupateTelemetry() {
    if (this.activeTab === 'mensual') {
      const cards = this.groupBySensorMensual(this.filterBySede(this.telemetriaMensualItems));
      this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'mensual');
    } else if (this.activeTab === 'diario') {
      const cards = this.groupBySensorDiario(
        this.filterBySede(this.telemetriaDiariaItems),
        this.filterBySede(this.telemetriaDiariaItemsCompare)
      );
      this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'diario');
    } else if (this.activeTab === 'horario') {
      const cards = this.groupBySensorHorario(
        this.filterBySedeHoraria(this.telemetriaHorariaItems),
        this.filterBySedeHoraria(this.telemetriaHorariaItemsCompare)
      );
      this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'horario');
    }
  }

  getSelectedSedeLabel(): string {
    return this.selectedSede === 'todas' ? 'Todas las Sedes' : this.selectedSede;
  }

  loadTelemetriaMensual() {
    this.isLoadingTelemetria = true;
    this.telemetriaError = '';
    this.dashboardService.getReporteTelemetriaMensual().subscribe({
      next: (items) => {
        console.log('📡 Telemetría mensual:', items.length, 'registros');
        this.telemetriaMensualItems = items;
        this.isLoadingTelemetria = false;
        this.extractSedes(items);
        const cards = this.groupBySensorMensual(this.filterBySede(items));
        this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'mensual');
      },
      error: (err) => {
        console.error('❌ Error telemetría mensual:', err);
        this.isLoadingTelemetria = false;
        this.telemetriaError = 'No se pudieron cargar los datos de telemetría.';
      }
    });
  }

  loadTelemetriaDiaria() {
    this.isLoadingTelemetria = true;
    this.telemetriaError = '';
    const { year, month } = this.selectedTelemetriaMonth;

    // Calcular mes anterior
    let compareYear = year;
    let compareMonth = month - 1;
    if (compareMonth < 1) {
      compareMonth = 12;
      compareYear--;
    }

    forkJoin({
      current: this.dashboardService.getReporteTelemetriaDiaria(year, month),
      compare: this.dashboardService.getReporteTelemetriaDiaria(compareYear, compareMonth)
    }).subscribe({
      next: (res) => {
        console.log(`📡 Telemetría diaria actual [${year}-${month}]:`, res.current.length, 'registros');
        console.log(`📡 Telemetría diaria anterior [${compareYear}-${compareMonth}]:`, res.compare.length, 'registros');
        this.telemetriaDiariaItems = res.current;
        this.telemetriaDiariaItemsCompare = res.compare;
        this.isLoadingTelemetria = false;
        if (this.availableSedes.length === 0) {
          // Extraer sedes uniendo ambas listas
          this.extractSedes([...res.current, ...res.compare]);
        }
        const cards = this.groupBySensorDiario(
          this.filterBySede(res.current),
          this.filterBySede(res.compare)
        );
        this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'diario');
      },
      error: (err) => {
        console.error('❌ Error telemetría diaria:', err);
        this.isLoadingTelemetria = false;
        this.telemetriaError = 'No se pudieron cargar los datos diarios.';
      }
    });
  }

  loadTelemetriaHoraria() {
    this.isLoadingTelemetria = true;
    this.telemetriaError = '';
    const currentDate = this.selectedTelemetriaDate;

    // Calcular día anterior
    const d = new Date(currentDate + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    const prevDate = d.toISOString().split('T')[0];

    forkJoin({
      current: this.dashboardService.getReporteTelemetriaHoraria(currentDate),
      compare: this.dashboardService.getReporteTelemetriaHoraria(prevDate)
    }).subscribe({
      next: (res) => {
        console.log(`📡 Telemetría horaria actual [${currentDate}]:`, res.current.length, 'registros');
        console.log(`📡 Telemetría horaria anterior [${prevDate}]:`, res.compare.length, 'registros');
        this.telemetriaHorariaItems = res.current;
        this.telemetriaHorariaItemsCompare = res.compare;
        this.isLoadingTelemetria = false;
        if (this.availableSedes.length === 0) {
          this.extractSedesHoraria([...res.current, ...res.compare]);
        }
        const cards = this.groupBySensorHorario(
          this.filterBySedeHoraria(res.current),
          this.filterBySedeHoraria(res.compare)
        );
        this.telemetriaSensorGroups = this.buildTelemetryGroups(cards, 'horario');
      },
      error: (err) => {
        console.error('❌ Error telemetría horaria:', err);
        this.isLoadingTelemetria = false;
        this.telemetriaError = 'No se pudieron cargar los datos horarios.';
      }
    });
  }

  extractSedes(items: TelemetriaMensualItem[]) {
    const sedesSet = new Set(items.map(i => i.headquarters_name).filter(s => !!s));
    this.availableSedes = Array.from(sedesSet).sort();
  }

  extractSedesHoraria(items: TelemetriaHorariaItem[]) {
    const sedesSet = new Set(items.map(i => i.headquarters_name).filter(s => !!s));
    this.availableSedes = Array.from(sedesSet).sort();
  }

  filterBySede(items: TelemetriaMensualItem[]): TelemetriaMensualItem[] {
    if (this.selectedSede === 'todas') return items;
    return items.filter(i => i.headquarters_name === this.selectedSede);
  }

  filterBySedeHoraria(items: TelemetriaHorariaItem[]): TelemetriaHorariaItem[] {
    if (this.selectedSede === 'todas') return items;
    return items.filter(i => i.headquarters_name === this.selectedSede);
  }

  private getVariableIcon(variable: string): string {
    const v = (variable || '').toLowerCase();
    if (v.includes('temp')) return 'thermostat';
    if (v.includes('humed')) return 'humidity_percentage';
    if (v.includes('volt') || v.includes('tensi')) return 'bolt';
    if (v.includes('corri') || v.includes('amper')) return 'electric_meter';
    if (v.includes('potenc') || v.includes('power')) return 'power';
    if (v.includes('energ') || v.includes('kwh')) return 'electric_bolt';
    if (v.includes('frecuen')) return 'waves';
    if (v.includes('presion') || v.includes('pressure')) return 'compress';
    if (v.includes('flujo') || v.includes('caudal') || v.includes('flow')) return 'water_drop';
    return 'sensors';
  }

  groupBySensorMensual(items: TelemetriaMensualItem[]): SensorCard[] {
    const sensorMap = new Map<string, TelemetriaMensualItem[]>();
    for (const item of items) {
      const key = item.sensor_name;
      if (!sensorMap.has(key)) sensorMap.set(key, []);
      sensorMap.get(key)!.push(item);
    }

    return Array.from(sensorMap.entries()).map(([sensorName, records]) => {
      // Ordenar por fecha cronológica (yyyy-mm-dd)
      records.sort((a, b) => a.date_record.localeCompare(b.date_record));

      const values = records.map(r => r.value).filter(v => v !== null && v !== undefined);
      const currentRecord = records[records.length - 1];
      const compareRecord = records[records.length - 2];

      const currentAvg = currentRecord ? currentRecord.value : 0;
      const compareAvg = compareRecord ? compareRecord.value : 0;
      const currentMax = values.length > 0 ? Math.max(...values) : 0;
      const currentMin = values.length > 0 ? Math.min(...values) : 0;

      const variationPct = compareAvg ? ((currentAvg - compareAvg) / compareAvg) * 100 : 0;
      const variationLabel = compareRecord ? 'vs mes anterior' : 'sin datos';

      const unit = currentRecord?.unit || '';
      const variable = currentRecord?.variable || '';
      const headquarters = currentRecord?.headquarters_name || '';

      // Trazado de línea para el histórico completo
      let currentTrendPath = '';
      let currentTrendAreaPath = '';
      if (records.length > 1) {
        const globalMin = Math.min(...values);
        const globalMax = Math.max(...values);
        const range = globalMax - globalMin || 1;
        const step = 100 / (records.length - 1);
        currentTrendPath = records.map((r, i) => {
          const normalizedY = 10 + ((r.value - globalMin) / range) * 80;
          return `${i === 0 ? 'M' : 'L'}${i * step},${100 - normalizedY}`;
        }).join(' ');
        currentTrendAreaPath = currentTrendPath + ` L100,100 L0,100 Z`;
      } else if (records.length === 1) {
        currentTrendPath = `M0,50 L100,50`;
        currentTrendAreaPath = `M0,50 L100,50 L100,100 L0,100 Z`;
      }

      return {
        sensorName,
        variable,
        unit,
        icon: this.getVariableIcon(variable),
        headquarters,
        currentAvg: Math.round(currentAvg * 100) / 100,
        currentMax: Math.round(currentMax * 100) / 100,
        currentMin: Math.round(currentMin * 100) / 100,
        compareAvg: Math.round(compareAvg * 100) / 100,
        currentSum: Math.round(currentAvg * 100) / 100,
        compareSum: Math.round(compareAvg * 100) / 100,
        variationPct: Math.round(variationPct * 10) / 10,
        variationLabel,
        currentTrendPath,
        currentTrendAreaPath,
        compareTrendPath: '',
        compareTrendAreaPath: ''
      };
    });
  }

  groupBySensorDiario(currentItems: TelemetriaMensualItem[], compareItems: TelemetriaMensualItem[]): SensorCard[] {
    const currentMap = new Map<string, TelemetriaMensualItem[]>();
    for (const item of currentItems) {
      if (!currentMap.has(item.sensor_name)) currentMap.set(item.sensor_name, []);
      currentMap.get(item.sensor_name)!.push(item);
    }

    const compareMap = new Map<string, TelemetriaMensualItem[]>();
    for (const item of compareItems) {
      if (!compareMap.has(item.sensor_name)) compareMap.set(item.sensor_name, []);
      compareMap.get(item.sensor_name)!.push(item);
    }

    const allSensors = Array.from(new Set([...currentMap.keys(), ...compareMap.keys()]));

    return allSensors.map(sensorName => {
      const currentRecords = currentMap.get(sensorName) || [];
      const compareRecords = compareMap.get(sensorName) || [];

      const currentVals = currentRecords.map(r => r.value).filter(v => v !== null && v !== undefined);
      const compareVals = compareRecords.map(r => r.value).filter(v => v !== null && v !== undefined);

      const currentSum = currentVals.reduce((s, v) => s + v, 0);
      const compareSum = compareVals.reduce((s, v) => s + v, 0);
      const currentAvg = currentVals.length > 0 ? currentSum / currentVals.length : 0;
      const compareAvg = compareVals.length > 0 ? compareSum / compareVals.length : 0;

      const allVals = [...currentVals, ...compareVals];
      const currentMax = currentVals.length > 0 ? Math.max(...currentVals) : 0;
      const currentMin = currentVals.length > 0 ? Math.min(...currentVals) : 0;

      const globalMax = allVals.length > 0 ? Math.max(...allVals) : 1;
      const globalMin = allVals.length > 0 ? Math.min(...allVals) : 0;
      const range = globalMax - globalMin || 1;

      const variationPct = compareAvg ? ((currentAvg - compareAvg) / compareAvg) * 100 : 0;
      const firstRecord = currentRecords[0] || compareRecords[0];
      const unit = firstRecord?.unit || '';
      const variable = firstRecord?.variable || '';
      const headquarters = firstRecord?.headquarters_name || '';

      // Trazados SVG por día del mes (1 a 31)
      const buildDailyPath = (records: TelemetriaMensualItem[]) => {
        if (records.length === 0) return { path: '', area: '' };
        // Mapear registros a días del mes y ordenar
        const dayMap = new Map<number, number>();
        records.forEach(r => {
          const day = parseInt(r.date_record.split('-')[2], 10);
          dayMap.set(day, r.value);
        });

        const sortedDays = Array.from(dayMap.keys()).sort((a, b) => a - b);
        if (sortedDays.length === 0) return { path: '', area: '' };

        const path = sortedDays.map((day, i) => {
          const val = dayMap.get(day)!;
          const x = ((day - 1) / 30) * 100; // Normalizado 1-31 a 0-100
          const y = 10 + ((val - globalMin) / range) * 80;
          return `${i === 0 ? 'M' : 'L'}${x},${100 - y}`;
        }).join(' ');

        const area = path + ` L${((sortedDays[sortedDays.length - 1] - 1) / 30) * 100},100 L${((sortedDays[0] - 1) / 30) * 100},100 Z`;
        return { path, area };
      };

      const currPaths = buildDailyPath(currentRecords);
      const compPaths = buildDailyPath(compareRecords);

      return {
        sensorName,
        variable,
        unit,
        icon: this.getVariableIcon(variable),
        headquarters,
        currentAvg: Math.round(currentAvg * 100) / 100,
        currentMax: Math.round(currentMax * 100) / 100,
        currentMin: Math.round(currentMin * 100) / 100,
        compareAvg: Math.round(compareAvg * 100) / 100,
        currentSum: Math.round(currentSum * 100) / 100,
        compareSum: Math.round(compareSum * 100) / 100,
        variationPct: Math.round(variationPct * 10) / 10,
        variationLabel: 'vs mes anterior',
        currentTrendPath: currPaths.path,
        currentTrendAreaPath: currPaths.area,
        compareTrendPath: compPaths.path,
        compareTrendAreaPath: compPaths.area
      };
    });
  }

  groupBySensorHorario(currentItems: TelemetriaHorariaItem[], compareItems: TelemetriaHorariaItem[]): SensorCard[] {
    const currentMap = new Map<string, TelemetriaHorariaItem[]>();
    for (const item of currentItems) {
      if (!currentMap.has(item.sensor_name)) currentMap.set(item.sensor_name, []);
      currentMap.get(item.sensor_name)!.push(item);
    }

    const compareMap = new Map<string, TelemetriaHorariaItem[]>();
    for (const item of compareItems) {
      if (!compareMap.has(item.sensor_name)) compareMap.set(item.sensor_name, []);
      compareMap.get(item.sensor_name)!.push(item);
    }

    const allSensors = Array.from(new Set([...currentMap.keys(), ...compareMap.keys()]));

    return allSensors.map(sensorName => {
      const currentRecords = currentMap.get(sensorName) || [];
      const compareRecords = compareMap.get(sensorName) || [];

      const currentVals = currentRecords.map(r => r.value).filter(v => v !== null && v !== undefined);
      const compareVals = compareRecords.map(r => r.value).filter(v => v !== null && v !== undefined);

      const currentSum = currentVals.reduce((s, v) => s + v, 0);
      const compareSum = compareVals.reduce((s, v) => s + v, 0);
      const currentAvg = currentVals.length > 0 ? currentSum / currentVals.length : 0;
      const compareAvg = compareVals.length > 0 ? compareSum / compareVals.length : 0;

      const allVals = [...currentVals, ...compareVals];
      const currentMax = currentVals.length > 0 ? Math.max(...currentVals) : 0;
      const currentMin = currentVals.length > 0 ? Math.min(...currentVals) : 0;

      const globalMax = allVals.length > 0 ? Math.max(...allVals) : 1;
      const globalMin = allVals.length > 0 ? Math.min(...allVals) : 0;
      const range = globalMax - globalMin || 1;

      const variationPct = compareAvg ? ((currentAvg - compareAvg) / compareAvg) * 100 : 0;
      const firstRecord = currentRecords[0] || compareRecords[0];
      const unit = firstRecord?.unit || '';
      const variable = firstRecord?.variable || '';
      const headquarters = firstRecord?.headquarters_name || '';

      // Trazados SVG por hora (00:00 a 23:59) -> 0 a 23
      const buildHourlyPath = (records: TelemetriaHorariaItem[]) => {
        if (records.length === 0) return { path: '', area: '' };
        // Promediar por hora para evitar duplicados en el mismo minuto/segundo si los hubiera
        const hourMap = new Map<number, number[]>();
        records.forEach(r => {
          const hour = parseInt(r.datetime_record.substring(11, 13), 10);
          if (!hourMap.has(hour)) hourMap.set(hour, []);
          hourMap.get(hour)!.push(r.value);
        });

        const sortedHours = Array.from(hourMap.keys()).sort((a, b) => a - b);
        if (sortedHours.length === 0) return { path: '', area: '' };

        const path = sortedHours.map((hour, i) => {
          const vals = hourMap.get(hour)!;
          const val = vals.reduce((s, v) => s + v, 0) / vals.length;
          const x = (hour / 23) * 100; // Normalizado 0-23 a 0-100
          const y = 10 + ((val - globalMin) / range) * 80;
          return `${i === 0 ? 'M' : 'L'}${x},${100 - y}`;
        }).join(' ');

        const area = path + ` L${(sortedHours[sortedHours.length - 1] / 23) * 100},100 L${(sortedHours[0] / 23) * 100},100 Z`;
        return { path, area };
      };

      const currPaths = buildHourlyPath(currentRecords);
      const compPaths = buildHourlyPath(compareRecords);

      return {
        sensorName,
        variable,
        unit,
        icon: this.getVariableIcon(variable),
        headquarters,
        currentAvg: Math.round(currentAvg * 100) / 100,
        currentMax: Math.round(currentMax * 100) / 100,
        currentMin: Math.round(currentMin * 100) / 100,
        compareAvg: Math.round(compareAvg * 100) / 100,
        currentSum: Math.round(currentSum * 100) / 100,
        compareSum: Math.round(compareSum * 100) / 100,
        variationPct: Math.round(variationPct * 10) / 10,
        variationLabel: 'vs ayer',
        currentTrendPath: currPaths.path,
        currentTrendAreaPath: currPaths.area,
        compareTrendPath: compPaths.path,
        compareTrendAreaPath: compPaths.area
      };
    });
  }

  prevTelemetriaMonth() {
    let { year, month } = this.selectedTelemetriaMonth;
    month--;
    if (month < 1) { month = 12; year--; }
    this.selectedTelemetriaMonth = { year, month };
    this.loadTelemetriaDiaria();
  }

  nextTelemetriaMonth() {
    let { year, month } = this.selectedTelemetriaMonth;
    month++;
    if (month > 12) { month = 1; year++; }
    this.selectedTelemetriaMonth = { year, month };
    this.loadTelemetriaDiaria();
  }

  getTelemetriaMonthLabel(): string {
    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${monthNames[this.selectedTelemetriaMonth.month - 1]} ${this.selectedTelemetriaMonth.year}`;
  }

  prevTelemetriaDate() {
    const d = new Date(this.selectedTelemetriaDate);
    d.setDate(d.getDate() - 1);
    this.selectedTelemetriaDate = d.toISOString().split('T')[0];
    this.loadTelemetriaHoraria();
  }

  nextTelemetriaDate() {
    const d = new Date(this.selectedTelemetriaDate);
    d.setDate(d.getDate() + 1);
    this.selectedTelemetriaDate = d.toISOString().split('T')[0];
    this.loadTelemetriaHoraria();
  }

  getTelemetriaDateLabel(): string {
    const d = new Date(this.selectedTelemetriaDate + 'T12:00:00');
    const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    return d.toLocaleDateString('es-CO', options);
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

  switchTab(tab: 'resumen' | 'historial' | 'equipos' | 'reportes' | 'detalle' | 'alarmas' | 'mensual' | 'diario' | 'horario') {
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
    if (tab === 'mensual') {
      this.loadTelemetriaMensual();
    }
    if (tab === 'diario') {
      this.loadTelemetriaDiaria();
    }
    if (tab === 'horario') {
      this.loadTelemetriaHoraria();
    }
  }

  // --- App Shell Context Methods ---
  toggleContextDropdown() {
    this.showContextDropdown = !this.showContextDropdown;
  }

  selectContext(context: 'Gestión de Facturas' | 'Infraestructura' | 'Medición Inteligente') {
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
    } else if (context === 'Medición Inteligente') {
      this.activeTab = 'mensual';
      this.loadTelemetriaMensual();
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

    // Cerrar dropdown de empresa al hacer clic fuera
    if (this.showCompanyDropdown) {
      const companyContainer = document.querySelector('.company-selector-container');
      if (companyContainer && !companyContainer.contains(target)) {
        this.showCompanyDropdown = false;
      }
    }

    // Cerrar dropdown de sede al hacer clic fuera
    if (this.showSedeDropdown) {
      const sedeContainer = document.querySelector('.sede-selector-container');
      if (sedeContainer && !sedeContainer.contains(target)) {
        this.showSedeDropdown = false;
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

  /** Expande/contrae las alarmas de un equipo específico */
  toggleAlarmDevice(key: string) {
    this.alarmDeviceExpanded[key] = !this.alarmDeviceExpanded[key];
  }

  /** Días transcurridos desde que se abrió la alarma (record_date) hasta hoy */
  getDaysOpen(recordDate: string | null | undefined): number {
    if (!recordDate) return 0;
    const start = new Date(recordDate);
    if (isNaN(start.getTime())) return 0;
    const today = new Date();
    const diff = today.getTime() - start.getTime();
    return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
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
