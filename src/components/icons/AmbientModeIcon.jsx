export default function AmbientModeIcon({ className = 'w-5 h-5' }) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {/* กรอบหน้าจอตรงกลาง */}
            <rect x="4" y="7" width="16" height="10" rx="2" />

            {/* ขีดแสงด้านบน 3 ขีด */}
            <path d="M12 2v2" />
            <path d="M6.5 3.5l1.5 1.5" />
            <path d="M17.5 3.5l-1.5 1.5" />

            {/* ขีดแสงด้านล่าง 3 ขีด */}
            <path d="M12 20v2" />
            <path d="M6.5 20.5l1.5-1.5" />
            <path d="M17.5 20.5l-1.5-1.5" />
        </svg>
    );
}