// Generated from svgs/IconTextBold.svg
import { type Color, Colors } from '../Color';

interface IconProps {
  size?: 10 | 12 | 16 | 20 | 32 | 48 | '1em';
  color?: keyof Color | 'currentcolor';
  style?: React.CSSProperties;
  className?: string;
}

// prettier-ignore
export const IconTextBold = ({
	size = 16,
	color = "currentcolor",
	style,
	className,
	...props
}: IconProps) => {
	const height = size;
	const width = size === "1em" ? "1em" : Math.round(Number(size) * 1);

	return (
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width={width} height={height} fill={Colors[color as 'black'] || color} style={style} className={`pi ${className ? className : ''}`} {...props}><path d="M3.6 15.317v-14h5.252q1.256 0 2.16.427.913.428 1.398 1.213.495.776.495 1.843v.02q0 .727-.323 1.368-.315.64-.847 1.077a2.64 2.64 0 0 1-1.2.562v.156q.943.116 1.628.572.686.456 1.056 1.184.38.717.38 1.64v.019q0 1.223-.56 2.105-.553.873-1.59 1.349-1.037.465-2.502.465zm7.44-2.173q.8-.63.8-1.834v-.019q0-.805-.372-1.349-.37-.542-1.113-.815-.732-.27-1.827-.271H5.312v4.919H8.69q1.55 0 2.35-.63M5.312 7.352h2.731q1.56 0 2.34-.563.79-.562.79-1.668V5.1q0-1.067-.704-1.65-.704-.591-1.979-.591H5.312z" /></svg>
	);
};

export { IconTextBold as ReactComponent };
