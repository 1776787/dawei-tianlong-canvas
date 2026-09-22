export function TianlongSeal({ className = "" }: { className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={`tianlong-seal ${className}`}
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                placeItems: "center",
                flexShrink: 0,
                aspectRatio: "1",
                background: "#bf4235",
                color: "#fff6ee",
                border: "1px solid #d26d61",
                padding: "3px",
                fontFamily: '"KaiTi", "STKaiti", "SimSun", serif',
                fontWeight: 700,
                lineHeight: 1,
                letterSpacing: 0,
            }}
        >
            <span>大</span>
            <span>威</span>
            <span>天</span>
            <span>龍</span>
        </span>
    );
}
