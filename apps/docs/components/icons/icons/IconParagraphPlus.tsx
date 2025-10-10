// Generated from svgs/IconParagraphPlus.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconParagraphPlus = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M3.75 1.5a.75.75 0 0 0-1.5 0V3H.75a.75.75 0 0 0 0 1.5h1.5V6a.75.75 0 0 0 1.5 0V4.5h1.5a.75.75 0 0 0 0-1.5h-1.5zM7.75 1a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5zM7.75 5a.75.75 0 0 0 0 1.5h7.5a.75.75 0 0 0 0-1.5zM.75 9a.75.75 0 0 0 0 1.5h14.5a.75.75 0 0 0 0-1.5zM.75 13a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5z" /></svg>
	);
};

export { IconParagraphPlus as ReactComponent };
