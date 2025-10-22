// Generated from svgs/IconBrandDiscord.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconBrandDiscord = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1.125);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M15.238 2.033A15 15 0 0 0 11.574.896a.06.06 0 0 0-.059.028c-.158.281-.334.65-.456.937a13.7 13.7 0 0 0-4.116 0A9 9 0 0 0 6.48.924a.06.06 0 0 0-.06-.028 15 15 0 0 0-3.664 1.137.05.05 0 0 0-.023.02C.4 5.54-.24 8.942.074 12.3a.06.06 0 0 0 .024.042 15 15 0 0 0 4.494 2.272.06.06 0 0 0 .063-.021q.521-.71.92-1.495a.056.056 0 0 0-.031-.08 10 10 0 0 1-1.404-.668.06.06 0 0 1-.023-.074l.017-.022q.144-.107.28-.22a.06.06 0 0 1 .057-.007c2.946 1.345 6.135 1.345 9.046 0a.06.06 0 0 1 .06.008q.136.112.278.219a.057.057 0 0 1 .015.076.1.1 0 0 1-.02.02 9.3 9.3 0 0 1-1.404.668.057.057 0 0 0-.03.08c.27.523.579 1.022.918 1.495a.06.06 0 0 0 .064.021 14.9 14.9 0 0 0 4.5-2.272.06.06 0 0 0 .024-.042c.376-3.882-.629-7.255-2.661-10.244a.04.04 0 0 0-.023-.022m-9.223 8.22c-.887 0-1.617-.814-1.617-1.813 0-1 .716-1.814 1.617-1.814.908 0 1.632.82 1.618 1.814 0 1-.717 1.814-1.618 1.814m5.98 0c-.886 0-1.617-.814-1.617-1.813 0-1 .717-1.814 1.618-1.814.908 0 1.632.82 1.617 1.814 0 1-.71 1.814-1.617 1.814"/></svg>
	);
};

export { IconBrandDiscord as ReactComponent };