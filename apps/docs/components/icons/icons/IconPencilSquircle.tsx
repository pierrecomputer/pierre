// Generated from svgs/IconPencilSquircle.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPencilSquircle = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1.772 4.497C1.578 5.377 1.5 6.517 1.5 8s.078 2.622.272 3.503c.191.873.485 1.443.883 1.842.399.398.97.692 1.842.883.88.194 2.02.272 3.503.272s2.622-.078 3.503-.272c.873-.191 1.443-.485 1.842-.883.398-.399.692-.97.883-1.842.194-.88.272-2.02.272-3.503q0-.65-.021-1.22a.75.75 0 1 1 1.499-.057Q16 7.327 16 8c0 1.516-.078 2.784-.306 3.825-.23 1.05-.624 1.916-1.289 2.58s-1.53 1.058-2.58 1.289C10.784 15.922 9.516 16 8 16s-2.784-.078-3.825-.306c-1.05-.23-1.916-.624-2.58-1.289s-1.058-1.53-1.288-2.58C.078 10.784 0 9.516 0 8s.078-2.784.307-3.825c.23-1.05.623-1.916 1.288-2.58C2.259.93 3.125.537 4.175.307 5.216.078 6.484 0 8 0q.675 0 1.282.022a.75.75 0 0 1-.057 1.5A32 32 0 0 0 8 1.5c-1.484 0-2.622.078-3.503.272-.873.191-1.443.485-1.842.883-.398.399-.692.97-.883 1.842" /><path d="m15.44.94-.38-.38a1.5 1.5 0 0 0-2.12 0L6.537 6.963a.3.3 0 0 0-.057.089l-1.288 3.434a.25.25 0 0 0 .322.322l3.434-1.288a.3.3 0 0 0 .09-.057l6.4-6.401a1.5 1.5 0 0 0 0-2.122" /></svg>
	);
};

export { IconPencilSquircle as ReactComponent };
