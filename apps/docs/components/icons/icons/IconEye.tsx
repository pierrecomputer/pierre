// Generated from svgs/IconEye.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconEye = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6"/><path d="M16 8c0 1.05-3.582 6-8 6S0 9.2 0 8s3.582-6 8-6 8 4.95 8 6m-1.48-.181-.002.004zm-.4-.372a10.4 10.4 0 0 0-1.494-1.75C11.307 4.448 9.66 3.5 8 3.5c-1.675 0-3.325.927-4.634 2.147a9.8 9.8 0 0 0-1.482 1.73c-.169.258-.28.468-.345.617L1.536 8l.003.006c.064.149.176.359.345.617a9.8 9.8 0 0 0 1.482 1.73C4.675 11.573 6.326 12.5 8 12.5c1.66 0 3.307-.949 4.626-2.196a10.4 10.4 0 0 0 1.494-1.751A5 5 0 0 0 14.443 8a5 5 0 0 0-.323-.553m.398.73.001.004z"/></svg>
	);
};

export { IconEye as ReactComponent };