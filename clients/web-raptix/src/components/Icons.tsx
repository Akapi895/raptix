import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const icon = (path: string | string[], opts?: { fill?: boolean }) =>
  function Icon({ size = 16, className, ...rest }: IconProps) {
    const paths = Array.isArray(path) ? path : [path]
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={opts?.fill ? 'currentColor' : 'none'}
        stroke={opts?.fill ? 'none' : 'currentColor'}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...rest}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    )
  }

export const FolderIcon = icon('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z')
export const GridIcon = icon([
  'M3 3h7v7H3z',
  'M14 3h7v7h-7z',
  'M14 14h7v7h-7z',
  'M3 14h7v7H3z',
])
export const MessageIcon = icon([
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
])
export const CpuIcon = icon([
  'M18 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z',
  'M9 9h6v6H9z',
  'M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M20 9h3M1 15h3M20 15h3',
])
export const ListIcon = icon([
  'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
])
export const TerminalIcon = icon(['M4 17l6-6-6-6M12 19h8'])
export const KeyIcon = icon([
  'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
])
export const DatabaseIcon = icon([
  'M12 2C6.48 2 2 3.79 2 6v12c0 2.21 4.48 4 10 4s10-1.79 10-4V6c0-2.21-4.48-4-10-4z',
  'M2 6c0 2.21 4.48 4 10 4s10-1.79 10-4',
  'M2 12c0 2.21 4.48 4 10 4s10-1.79 10-4',
])
export const AlertTriangleIcon = icon([
  'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  'M12 9v4M12 17h.01',
])
export const SettingsIcon = icon([
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
])
export const BellIcon = icon([
  'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
])
export const SearchIcon = icon([
  'M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z',
])
export const PlusIcon = icon(['M12 5v14M5 12h14'])
export const ChevronRightIcon = icon(['M9 18l6-6-6-6'])
export const ChevronDownIcon = icon(['M6 9l6 6 6-6'])
export const XIcon = icon(['M18 6L6 18M6 6l12 12'])
export const CheckIcon = icon(['M20 6L9 17l-5-5'])
export const ShieldIcon = icon([
  'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
])
export const UserIcon = icon([
  'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2',
  'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
])
export const SendIcon = icon(['M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z'])
export const ExternalLinkIcon = icon([
  'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
  'M15 3h6v6M10 14L21 3',
])
export const ActivityIcon = icon([
  'M22 12h-4l-3 9L9 3l-3 9H2',
])
export const EyeOffIcon = icon([
  'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24',
  'M1 1l22 22',
])
export const RefreshIcon = icon([
  'M23 4v6h-6M1 20v-6h6',
  'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
])
export const ClipboardIcon = icon([
  'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2',
  'M15 2H9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1z',
])
export const FilterIcon = icon([
  'M22 3H2l8 9.46V19l4 2v-8.54L22 3z',
])
export const DownloadIcon = icon(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3'])
export const MoreIcon = icon(['M12 5h.01M12 12h.01M12 19h.01'], { fill: false })
export const BotIcon = icon([
  'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7H3a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z',
  'M7 14v1a5 5 0 0 0 10 0v-1',
  'M8.5 14h.01M15.5 14h.01',
])
export const ZapIcon = icon(['M13 2L3 14h9l-1 8 10-12h-9l1-8z'])
export const LockIcon = icon([
  'M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z',
  'M7 11V7a5 5 0 0 1 10 0v4',
])
export const GlobeIcon = icon([
  'M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z',
  'M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
])
export const LayersIcon = icon([
  'M12 2L2 7l10 5 10-5-10-5z',
  'M2 17l10 5 10-5M2 12l10 5 10-5',
])
export const BarChart2Icon = icon([
  'M18 20V10M12 20V4M6 20v-6',
])
export const ArrowUpIcon = icon(['M12 19V5M5 12l7-7 7 7'])
export const ArrowDownIcon = icon(['M12 5v14M5 12l7 7 7-7'])
export const ClockIcon = icon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'])
export const PlayIcon = icon(['M5 3l14 9-14 9V3z'], { fill: true })
export const PauseIcon = icon(['M6 4h4v16H6zM14 4h4v16h-4z'])
export const StopIcon = icon(['M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z'], { fill: true })
export const InfoIcon = icon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M12 12v4'])
export const TagIcon = icon(['M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01'])
export const ScanIcon = icon(['M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2', 'M7 12h10'])
export const NetworkIcon = icon(['M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18'])
export const GitBranchIcon = icon(['M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9c-1.66 0-3 1.34-3 3v3a3 3 0 0 1-3 3H9'])
export const TargetIcon = icon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'])
export const BookIcon = icon(['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'])
export const FileTextIcon = icon(['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6M16 13H8M16 17H8M10 9H8'])
export const CameraIcon = icon(['M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'])
export const UploadIcon = icon(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'])
export const ChevronLeftIcon = icon(['M15 18l-6-6 6-6'])
export const ChevronUpIcon = icon(['M18 15l-6-6-6 6'])
export const TrendingUpIcon = icon(['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'])
export const MaximizeIcon = icon(['M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3'])
export const RadioIcon = icon(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'], { fill: false })
export const EditIcon = icon(['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'])
export const TrashIcon = icon(['M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'])
export const SendFileIcon = icon(['M22 2L11 13', 'M22 2L15 22l-4-9-9-4 20-7z'])
export const EyeIcon = icon(['M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'])
export const HashIcon = icon(['M4 9h16M4 15h16M10 3L8 21M16 3l-2 18'])
export const SlashIcon = icon(['M22 2L2 22'])
export const UsersIcon = icon(['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'])
