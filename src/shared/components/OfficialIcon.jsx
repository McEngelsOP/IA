const paths = {
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'M6 6l12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 8h11v13H9zM15 8V3H4v13h5',
  check: 'M5 12l4 4L19 6',
  link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  cap: 'M2 9l10-5 10 5-10 5-10-5m4 2v6c4 3 8 3 12 0v-6m4-2v7',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  monitor: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  sliders: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  bug: 'M8 8h8v9a4 4 0 0 1-8 0V8m1-3 3 3 3-3M4 11h4m8 0h4M4 17h4m8 0h4M12 8v12',
  trend: 'M3 17l6-6 4 4 8-10m-6 0h6v6',
  message: 'M4 4h16v12H8l-4 4V4',
  landmark: 'M3 8l9-5 9 5H3m2 3v7m7-7v7m7-7v7M3 21h18',
  lock: 'M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4',
}
export default function OfficialIcon({ name, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.message}/></svg>
}
