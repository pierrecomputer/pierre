// Generated from svgs/IconBook.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBook = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M3 5.5h3v-1H3zM3 7.5h3v-1H3zM3 9.5h3v-1H3zM3 11.5h3v-1H3zM10 5.5h3v-1h-3zM10 7.5h3v-1h-3zM10 9.5h3v-1h-3zM10 11.5h3v-1h-3z" /><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h3.539c.642 0 1.269.19 1.803.546l.492.328a.75.75 0 0 0 .832 0l.492-.328A3.25 3.25 0 0 1 10.711 15h3.539A1.75 1.75 0 0 0 16 13.25V2.75A1.75 1.75 0 0 0 14.25 1h-3.302A4.75 4.75 0 0 0 8 2.026 4.75 4.75 0 0 0 5.052 1zm5.382 2.253.118.098v10.573a4.75 4.75 0 0 0-1.961-.424H1.75a.25.25 0 0 1-.25-.25V2.75a.25.25 0 0 1 .25-.25h3.302c.76 0 1.496.267 2.08.753m3.58 10.247a4.75 4.75 0 0 0-1.962.424V3.35l.118-.098a3.25 3.25 0 0 1 2.08-.753h3.302a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25z" /></svg>
	);
};

export { IconBook as ReactComponent };
