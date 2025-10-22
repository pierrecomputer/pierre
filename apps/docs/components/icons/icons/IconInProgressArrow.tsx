// Generated from svgs/IconInProgressArrow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconInProgressArrow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 0.9411764705882353);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 17" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.504.98a.75.75 0 0 0-.494.632L.656 5.148a.75.75 0 0 0 .821.82l3.536-.353a.75.75 0 0 0 .456-1.277l-.876-.876a6.5 6.5 0 1 1-3.094 5.423A.75.75 0 1 0 0 8.86c-.012.73.076 1.473.274 2.211a8 8 0 1 0 3.235-8.692L2.287 1.156A.75.75 0 0 0 1.504.98"/><path d="M13.25 9a5.25 5.25 0 0 1-4.75 5.227.466.466 0 0 1-.5-.477v-9.5c0-.276.224-.503.5-.477.591.056 1.154.21 1.672.446a5.26 5.26 0 0 1 2.876 3.333c.131.46.202.946.202 1.448"/></svg>
	);
};

export { IconInProgressArrow as ReactComponent };