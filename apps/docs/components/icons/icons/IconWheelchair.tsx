// Generated from svgs/IconWheelchair.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconWheelchair = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M6 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4M7.282 5.684a1 1 0 0 0-1.897.632l1.666 5A1 1 0 0 0 8 12h2.465l1.703 2.555a1 1 0 0 0 1.075.415l1.03-.257a1 1 0 0 0-.486-1.94l-.346.086-1.609-2.414A1 1 0 0 0 11 10H8.72l-.333-1H10a1 1 0 1 0 0-2H7.72z" /><path d="M2 12c0-1.49.814-2.79 2.022-3.478L3.688 7.5H2a.5.5 0 0 1 0-1h2.05a.5.5 0 0 1 .475.344l1.042 3.181.536 1.608A2 2 0 0 0 8 13h1.874A4.002 4.002 0 0 1 2 12" /></svg>
	);
};

export { IconWheelchair as ReactComponent };
