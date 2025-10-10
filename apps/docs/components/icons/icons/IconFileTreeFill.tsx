// Generated from svgs/IconFileTreeFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFileTreeFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M1 11V0h1.5v2c0 .69.56 1.25 1.25 1.25H6V1.5A1.5 1.5 0 0 1 7.5 0h2.129a1.5 1.5 0 0 1 1.06.44l.122.12a1.5 1.5 0 0 0 1.06.44H13.5A1.5 1.5 0 0 1 15 2.5v3A1.5 1.5 0 0 1 13.5 7h-6A1.5 1.5 0 0 1 6 5.5v-.75H3.75c-.45 0-.875-.108-1.25-.3V11c0 .69.56 1.25 1.25 1.25H6V10.5A1.5 1.5 0 0 1 7.5 9h2.129a1.5 1.5 0 0 1 1.06.44l.122.12a1.5 1.5 0 0 0 1.06.44H13.5a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 14.5v-.75H3.75A2.75 2.75 0 0 1 1 11" /></svg>
	);
};

export { IconFileTreeFill as ReactComponent };
