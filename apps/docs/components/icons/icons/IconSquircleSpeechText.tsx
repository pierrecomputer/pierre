// Generated from svgs/IconSquircleSpeechText.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconSquircleSpeechText = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path fillRule="evenodd" d="M1.732 4.002C1.567 4.75 1.5 5.723 1.5 7c0 2.331.233 3.584.77 4.307.49.66 1.372 1.041 3.275 1.155l.216.013L8 14.155l2.24-1.68.215-.013c1.903-.114 2.785-.495 3.275-1.155.537-.723.77-1.976.77-4.307 0-1.277-.068-2.25-.232-2.998-.162-.74-.409-1.211-.734-1.536s-.796-.572-1.536-.734C11.25 1.567 10.277 1.5 9 1.5H7c-1.277 0-2.25.067-2.998.232-.74.162-1.211.409-1.536.734s-.572.796-.734 1.536M3.68.267C4.589.067 5.69 0 7 0h2c1.31 0 2.411.067 3.32.267.916.2 1.684.547 2.275 1.138s.937 1.359 1.138 2.276c.2.908.267 2.01.267 3.319 0 2.297-.198 4.033-1.065 5.2-.88 1.185-2.296 1.61-4.172 1.745L8 16l-2.763-2.055c-1.876-.136-3.293-.56-4.172-1.744C.2 11.033 0 9.297 0 7c0-1.31.067-2.411.267-3.32.2-.916.547-1.684 1.138-2.275S2.764.468 3.681.267" clipRule="evenodd" /><path fillRule="evenodd" d="M3.5 4.5A.5.5 0 0 1 4 4h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5m0 2.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5m0 2.5A.5.5 0 0 1 4 9h5a.5.5 0 0 1 0 1H4a.5.5 0 0 1-.5-.5" clipRule="evenodd" /></svg>
	);
};

export { IconSquircleSpeechText as ReactComponent };
