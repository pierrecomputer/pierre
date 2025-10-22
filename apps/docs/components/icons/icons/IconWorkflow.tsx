// Generated from svgs/IconWorkflow.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconWorkflow = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M1.75 0A1.75 1.75 0 0 0 0 1.75v4C0 6.716.784 7.5 1.75 7.5H3v2.25a2.75 2.75 0 0 0 2.75 2.75H7v1.75c0 .966.784 1.75 1.75 1.75h5.5A1.75 1.75 0 0 0 16 14.25v-4a1.75 1.75 0 0 0-1.75-1.75h-5.5A1.75 1.75 0 0 0 7 10.25V11H5.75c-.69 0-1.25-.56-1.25-1.25V7.5h2.75A1.75 1.75 0 0 0 9 5.75v-4A1.75 1.75 0 0 0 7.25 0zM1.5 1.75a.25.25 0 0 1 .25-.25h5.5a.25.25 0 0 1 .25.25v4a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25zM8.75 10a.25.25 0 0 0-.25.25v4c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-4a.25.25 0 0 0-.25-.25z" clip-rule="evenodd"/></svg>
	);
};

export { IconWorkflow as ReactComponent };