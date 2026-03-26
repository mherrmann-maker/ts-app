export interface WorkItem {
  id: string
  title: string
  category: string
  year: string
  description: string
  /** Drop your GLB here: e.g. '/models/world01.glb' */
  modelPath: string | null
  /** Drop your video here: e.g. '/videos/world01.mp4' */
  videoPath: string | null
  /** Or a static image: e.g. '/images/world01.jpg' */
  imagePath: string | null
  /** Accent color for this card */
  accent: string
}

export const works: WorkItem[] = [
  {
    id: 'w01',
    title: 'VOID 01',
    category: 'INTERACTIVE 3D',
    year: '2025',
    description: 'An immersive void that blurs the line between digital matter and pure sensation.',
    modelPath: null,   // → '/models/void01.glb'
    videoPath: null,   // → '/videos/void01.mp4'
    imagePath: null,
    accent: '#C9A84C',
  },
  {
    id: 'w02',
    title: 'DRIFT 02',
    category: 'REALTIME RENDER',
    year: '2025',
    description: 'Real-time environments driven by generative systems and physics simulation.',
    modelPath: null,
    videoPath: null,
    imagePath: null,
    accent: '#7B9FFF',
  },
  {
    id: 'w03',
    title: 'EMBER 03',
    category: 'XR EXPERIENCE',
    year: '2024',
    description: 'Extended reality — heat, light, and particle systems collide in spatial narrative.',
    modelPath: null,
    videoPath: null,
    imagePath: null,
    accent: '#FF7C5C',
  },
  {
    id: 'w04',
    title: 'STRATA 04',
    category: 'SPATIAL DESIGN',
    year: '2024',
    description: 'Layered spatial architectures that reveal new depth with every viewing angle.',
    modelPath: null,
    videoPath: null,
    imagePath: null,
    accent: '#5CFFB8',
  },
  {
    id: 'w05',
    title: 'HELIX 05',
    category: 'MOTION DESIGN',
    year: '2024',
    description: 'Motion driven by mathematical precision — organic chaos meets parametric order.',
    modelPath: null,
    videoPath: null,
    imagePath: null,
    accent: '#FFB347',
  },
  {
    id: 'w06',
    title: 'NACHT 06',
    category: 'GENERATIVE ART',
    year: '2024',
    description: 'Generative darkness — infinite variations drawn from a single algorithmic seed.',
    modelPath: null,
    videoPath: null,
    imagePath: null,
    accent: '#D87BFF',
  },
]
