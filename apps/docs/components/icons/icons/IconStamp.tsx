// Generated from svgs/IconStamp.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconStamp = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M6.393 2.08c-.378.357-.643.902-.643 1.67 0 .233.094.705.283 1.363.181.63.425 1.349.673 2.035a67 67 0 0 0 .8 2.102h.988a72 72 0 0 0 .8-2.102 34 34 0 0 0 .673-2.035c.189-.658.283-1.13.283-1.363 0-.768-.265-1.313-.643-1.67C9.222 1.719 8.665 1.5 8 1.5s-1.222.218-1.607.58m3.714 7.17a67 67 0 0 0 .599-1.593c.252-.7.508-1.455.702-2.13.186-.646.342-1.306.342-1.777 0-1.14-.406-2.094-1.114-2.76C9.935.328 8.992 0 8 0S6.065.329 5.364.99c-.708.666-1.114 1.62-1.114 2.76 0 .47.156 1.131.342 1.777.194.675.45 1.43.702 2.13.213.589.425 1.145.6 1.593H2.488a1.75 1.75 0 0 0-1.673 1.235L.033 13.03A.75.75 0 0 0 .75 14h14.5a.75.75 0 0 0 .717-.97l-.783-2.545a1.75 1.75 0 0 0-1.673-1.235zm-7.618 1.5a.25.25 0 0 0-.24.177L1.766 12.5h12.47l-.485-1.573a.25.25 0 0 0-.239-.177zM1 15.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5" clipRule="evenodd" /></svg>
	);
};

export { IconStamp as ReactComponent };
