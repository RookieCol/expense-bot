export const CATEGORIES = [
  { label: '🧗 Equipamiento', value: 'Equipment' },
  { label: '🔧 Mantenimiento', value: 'Maintenance' },
  { label: '💡 Servicios', value: 'Utilities' },
  { label: '🧹 Limpieza', value: 'Cleaning' },
  { label: '📣 Marketing', value: 'Marketing' },
  { label: '👕 Uniformes', value: 'Uniforms' },
  { label: '🏥 Seguros y Salud', value: 'Insurance & Health' },
  { label: '💼 Administración', value: 'Administration' },
  { label: '🎉 Eventos', value: 'Events' },
  { label: '🔀 Otro', value: 'Other' },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
);
