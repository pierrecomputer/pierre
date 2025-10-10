// Generated from svgs/IconReload.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconReload = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="m7.94 3-.592-.591a.75.75 0 1 1 1.061-1.06l2.121 2.12a.75.75 0 0 1 0 1.061L8.41 6.652a.75.75 0 0 1-1.06-1.061L8.42 4.519A4.5 4.5 0 1 0 12.5 9a.75.75 0 0 1 1.5.001 6 6 0 1 1-6.06-6" /></svg>
	);
};

export { IconReload as ReactComponent };
