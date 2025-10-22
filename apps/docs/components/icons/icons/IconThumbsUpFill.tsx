// Generated from svgs/IconThumbsUpFill.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconThumbsUpFill = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M7.25.5a.5.5 0 0 0-.493.582c.148.889.11 1.99.058 2.699a1.35 1.35 0 0 1-.404.85L4.146 6.647A.5.5 0 0 0 4 7v7a.5.5 0 0 0 .146.354c.226.225.535.392.86.523a7.4 7.4 0 0 0 1.123.334c.816.182 2.02.302 2.921.38a44 44 0 0 0 3.374.159h.076c.47 0 .95-.185 1.317-.473.365-.285.683-.729.683-1.277 0-.34-.087-.676-.226-.97a1.75 1.75 0 0 0 .936-1.55c0-.382-.07-.79-.28-1.123q.07-.048.137-.1c.365-.285.683-.729.683-1.277 0-.523-.23-.992-.593-1.313l.007-.01c.245-.34.336-.767.336-1.177a1.37 1.37 0 0 0-.317-.913 1.57 1.57 0 0 0-.771-.467c-.553-.16-1.25-.126-1.922-.027-.952.14-1.992.433-2.784.678.104-.43.196-.852.265-1.256.114-.672.168-1.329.082-1.91-.088-.593-.327-1.14-.823-1.529C8.743.674 8.08.5 7.25.5M.75 6a.75.75 0 0 0-.75.75v7.5c0 .414.336.75.75.75h1.5a.75.75 0 0 0 .75-.75v-7.5A.75.75 0 0 0 2.25 6z"/></svg>
	);
};

export { IconThumbsUpFill as ReactComponent };