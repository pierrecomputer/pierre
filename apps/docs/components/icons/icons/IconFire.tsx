// Generated from svgs/IconFire.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconFire = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path fillRule="evenodd" d="M13.535 6.875C13.275 6.005 13 5.094 13 3c-1.5.5-3 2.5-3 4.5-.084-.422-.155-.916-.23-1.444C9.4 3.454 8.91 0 6 0c.539 2.695-.665 4.083-1.89 5.494C3.063 6.701 2 7.926 2 10a6 6 0 0 0 12 0c0-1.579-.227-2.334-.465-3.125M11 11.429v-.471c0-.446-.295-.642-.711-.48l-.057.022c-.316.123-.648.252-1.047.358a.85.85 0 0 1-.993-.486c-.355-.793-.685-1.753-.908-2.446-.124-.387-.623-.477-.848-.139C5.845 8.68 5 10.175 5 11.43 5 12.849 6.343 14 8 14s3-1.151 3-2.571" clipRule="evenodd" /></svg>
	);
};

export { IconFire as ReactComponent };
