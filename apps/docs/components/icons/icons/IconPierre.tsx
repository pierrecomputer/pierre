// Generated from svgs/IconPierre.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconPierre = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.75);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 2.5A2.5 2.5 0 0 1 2.5 0h7A2.5 2.5 0 0 1 12 2.5v11A2.5 2.5 0 0 1 9.5 16h-7A2.5 2.5 0 0 1 0 13.5z"/></svg>
	);
};

export { IconPierre as ReactComponent };