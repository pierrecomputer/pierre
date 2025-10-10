// Generated from svgs/IconToken.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconToken = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] ?? color} style={style} className={`pi ${className ?? ''}`} {...props}><path d="M7 5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="M8.625.495a1.25 1.25 0 0 0-1.25 0L1.813 3.706a1.25 1.25 0 0 0-.625 1.083v6.422c0 .447.238.86.625 1.083l5.562 3.211a1.25 1.25 0 0 0 1.25 0l5.562-3.211a1.25 1.25 0 0 0 .625-1.083V4.79c0-.447-.238-.86-.625-1.083zM2.688 4.933 8 1.866l5.312 3.067v6.134L8 14.134l-5.312-3.067z" /></svg>
	);
};

export { IconToken as ReactComponent };
