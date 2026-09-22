import { useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, Clock3, FolderOpen, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { PromptLibrarySection } from "@/components/home/prompt-library-section";
import { TianlongSeal } from "@/components/home/tianlong-seal";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import "@/styles/tianlong-home.css";

const HOME_PALETTE_KEY = "infinite-canvas:home_palette";
const homePalettes = [
    { id: "garnet", accent: "#d95040", key: "cinnabar" },
    { id: "jade", accent: "#288777", key: "jade" },
    { id: "sapphire", accent: "#467ace", key: "sapphire" },
    { id: "amethyst", accent: "#9471af", key: "amethyst" },
    { id: "pearl", accent: "#898b83", key: "silver" },
] as const;

export default function IndexPage() {
    const { i18n, t } = useTranslation();
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const [paletteId, setPaletteId] = useState(() => {
        try {
            return window.localStorage.getItem(HOME_PALETTE_KEY) || "garnet";
        } catch {
            return "garnet";
        }
    });
    const palette = homePalettes.find((item) => item.id === paletteId) || homePalettes[0];
    const recentProjects = [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3);
    const createAndEnter = () => {
        const id = createProject(t("canvas.defaultTitle", { count: projects.length + 1 }));
        navigate(`/canvas/${id}`);
    };

    return (
        <main className="tl-home" style={{ "--home-accent": palette.accent } as CSSProperties}>
            <div className="tl-container">
                <header className="tl-masthead">
                    <div className="tl-brand">
                        <TianlongSeal className="tl-brand-seal" />
                        <div>
                            <p className="tl-overline">
                                DAWEI TIANLONG <span>/</span> CREATIVE STUDIO
                            </p>
                            <h1>{t("meta.title")}</h1>
                            <p className="tl-motto">{t("home.studio.motto")}</p>
                        </div>
                    </div>
                    <div className="tl-masthead-tools">
                        <div className="tl-palette" role="group" aria-label={t("home.palette")}>
                            <span>{t(`home.studio.${palette.key}`)}</span>
                            {homePalettes.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className="tl-swatch"
                                    style={{ "--swatch": item.accent } as CSSProperties}
                                    aria-label={t(`home.studio.${item.key}`)}
                                    title={t(`home.studio.${item.key}`)}
                                    aria-pressed={palette.id === item.id}
                                    onClick={() => {
                                        setPaletteId(item.id);
                                        try {
                                            window.localStorage.setItem(HOME_PALETTE_KEY, item.id);
                                        } catch {
                                            /* Palette stays usable when browser storage is blocked. */
                                        }
                                    }}
                                />
                            ))}
                        </div>
                        <div className="tl-actions">
                            <Link to="/canvas" className="tl-button tl-button-secondary">
                                <FolderOpen size={16} />
                                {t("home.openCanvas")}
                            </Link>
                            <button type="button" className="tl-button tl-button-primary" onClick={createAndEnter}>
                                <Plus size={17} />
                                {t("home.newCanvas")}
                            </button>
                        </div>
                    </div>
                </header>

                <section className="tl-workspace" aria-labelledby="recent-projects-title">
                    <div className="tl-section-heading">
                        <div className="tl-section-name">
                            <span className="tl-section-index">01</span>
                            <h2 id="recent-projects-title">{t("home.recentProjects")}</h2>
                            <span className="tl-count">{projects.length.toString().padStart(2, "0")}</span>
                        </div>
                        <Link to="/canvas" className="tl-text-link">
                            {t("home.viewAll")}
                            <ArrowRight size={15} />
                        </Link>
                    </div>
                    <div className={`tl-project-grid ${recentProjects.length ? "" : "tl-project-grid-empty"}`}>
                        <button type="button" className="tl-new-project" onClick={createAndEnter}>
                            <span className="tl-new-project-icon">
                                <Plus size={24} strokeWidth={1.4} />
                            </span>
                            <span>{t("home.studio.blankCanvas")}</span>
                            <ArrowUpRight size={16} className="tl-new-project-arrow" />
                        </button>
                        {recentProjects.length ? (
                            recentProjects.map((project) => (
                                <Link to={`/canvas/${project.id}`} key={project.id} className="tl-project">
                                    <div className="tl-project-preview">
                                        <ProjectMap project={project} />
                                        <ArrowUpRight size={16} />
                                    </div>
                                    <div className="tl-project-info">
                                        <h3 title={project.title}>{project.title}</h3>
                                        <span>{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</span>
                                        <time dateTime={project.updatedAt}>
                                            <Clock3 size={11} />
                                            {new Date(project.updatedAt).toLocaleString(i18n.resolvedLanguage, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                        </time>
                                    </div>
                                </Link>
                            ))
                        ) : (
                            <div className="tl-empty-workspace">
                                <span className="tl-empty-glyph" aria-hidden="true">
                                    起
                                </span>
                                <div>
                                    <h3>{t("home.studio.firstStroke")}</h3>
                                    <p>{t("home.noProjects")}</p>
                                </div>
                                <span className="tl-empty-number" aria-hidden="true">
                                    NO. 001
                                </span>
                            </div>
                        )}
                    </div>
                </section>
            </div>

            <PromptLibrarySection />
            <footer className="tl-footer tl-container">
                <span>
                    大威天龙 <span aria-hidden="true">/</span> DAWEI TIANLONG
                </span>
                <span>{t("home.studio.motto")}</span>
            </footer>
        </main>
    );
}

function ProjectMap({ project }: { project: CanvasProject }) {
    const nodes = project.nodes.slice(0, 40);
    if (!nodes.length)
        return (
            <span className="tl-empty-map" aria-hidden="true">
                <Plus size={22} strokeWidth={1} />
            </span>
        );
    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const width = Math.max(...nodes.map((node) => node.position.x + node.width)) - left;
    const height = Math.max(...nodes.map((node) => node.position.y + node.height)) - top;
    const colors: Record<string, string> = { image: "#57968b", video: "#bb7665", text: "#b2ab82", director: "#7a92aa", runninghub: "#57968b" };
    return (
        <svg viewBox={`${left - 40} ${top - 40} ${Math.max(width, 1) + 80} ${Math.max(height, 1) + 80}`} aria-hidden="true" className="tl-node-map">
            {project.connections.map((connection) => {
                const source = nodes.find((node) => node.id === connection.fromNodeId);
                const target = nodes.find((node) => node.id === connection.toNodeId);
                return source && target ? (
                    <line
                        key={connection.id}
                        x1={source.position.x + source.width}
                        y1={source.position.y + source.height / 2}
                        x2={target.position.x}
                        y2={target.position.y + target.height / 2}
                        stroke="currentColor"
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                    />
                ) : null;
            })}
            {nodes.map((node) => (
                <rect
                    key={node.id}
                    x={node.position.x}
                    y={node.position.y}
                    width={node.width}
                    height={node.height}
                    rx="12"
                    fill={colors[node.type] || "#85898a"}
                    fillOpacity=".18"
                    stroke={colors[node.type] || "#85898a"}
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </svg>
    );
}
