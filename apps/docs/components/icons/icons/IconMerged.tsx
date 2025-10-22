// Generated from svgs/IconMerged.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconMerged = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-6.5a6.5 6.5 0 0 0-4.919 10.75c1.308-.024 2.254-.603 2.931-1.371A5.7 5.7 0 0 0 7.14 8.838c.085-.273.11-.56.11-.845V6.561L6.03 7.78a.75.75 0 0 1-1.06-1.06l2.5-2.5a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 1 1-1.06 1.06L8.75 6.56v1.433c0 .286.025.572.11.845.2.649.568 1.406 1.128 2.041.677.768 1.623 1.347 2.93 1.37A6.48 6.48 0 0 0 14.5 8c0-.623-.088-1.225-.25-1.794a6.52 6.52 0 0 0-3.56-4.126A6.5 6.5 0 0 0 8 1.5m-.862 10.371c-.64.724-1.486 1.344-2.557 1.658A6.47 6.47 0 0 0 8 14.5a6.47 6.47 0 0 0 3.419-.97c-1.071-.315-1.918-.934-2.557-1.659A6.8 6.8 0 0 1 8 10.633a6.8 6.8 0 0 1-.862 1.238"/></svg>
	);
};

export { IconMerged as ReactComponent };