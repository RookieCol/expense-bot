export interface Expense {
  fecha: string;
  proveedor: string;
  categoria: string;
  descripcion: string;
  monto: number;
  facturaLink?: string;
}

export interface MonthlySummary {
  mes: string;
  total: number;
  porCategoria: Record<string, number>;
  cantidadGastos: number;
}
