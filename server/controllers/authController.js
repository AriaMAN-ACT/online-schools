const {promisify} = require('util');
const jsonWebToken = require('jsonwebtoken');

const User = require('../models/User');
const catchRequest = require('../utils/catchRequest');
const AppError = require('../utils/AppError');

exports.protect = catchRequest(async (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies.jwt) {
        token = req.cookies.jwt;
    }
    if (!token) {
        throw new AppError('0xE0000C', 401);
    }
    const decodedToken = await promisify(jsonWebToken.verify)(token, process.env.JSON_WEB_TOKEN_SECRET);
    const user = await User.findById(decodedToken.id);
    if (!user) {
        throw new AppError(
            '0xE0000D',
            401
        );
    }
    if (user.isPasswordChanged(decodedToken.iat)) {
        throw new AppError(
            '0xE0000E',
            401
        );
    }
    req.user = user;
    next();
});

exports.restrictTo = (...rotes) => {
    return catchRequest(
        async (req, res, next) => {
            if (rotes.includes(req.user.rote)) {
                return next();
            }
            if (rotes.includes('selfUser') &&
                !req.body.rote &&
                !req.body.password &&
                !req.body.passwordChangedAt &&
                !req.body.passwordResetToken &&
                !req.body.passwordResetExpires &&
                !req.body.isEmailVerified &&
                !req.body.verifyEmailToken &&
                !req.body.verifyEmailExpires) {
            }
            throw new AppError('0xE0000F', 403);
        }
    );
};

const signToken = ({_id}) => {
    return jsonWebToken.sign(
        {
            id: _id
        },
        process.env.JSON_WEB_TOKEN_SECRET,
        {
            expiresIn: process.env.JSON_WEB_TOKEN_TIME
        }
    );
};

const sendToken = (user, statusCode, res) => {
    const token = signToken(user);
    const cookieOptions = {
        expires: new Date(
            Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000
        ),
        httpOnly: true
    };
    if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;

    res.cookie('jwt', token, cookieOptions);

    user.password = undefined;

    res.cookie('jwt', token, {
        httpOnly: true
    });

    res.status(statusCode).json({
        status: 'success',
        token,
        data: {
            user
        }
    });
};

exports.logOut = (req, res) => {
    res.clearCookie('jwt');
    res.status(200).json({status: 'success'})
};

exports.signIn = catchRequest(async (req, res) => {
    const {username, password} = req.body;
    if (
        !username ||
        !password ||
        !/^(?=[a-zA-Z0-9._]{4,20}$)(?!.*[_.]{2})[^_.].*[^_.]$/.test(username) ||
        !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,100}$/.test(password)) {
        throw new AppError('0xE00010', 400);
    }
    const user = await User.findOne({username}).select('+password');

    if (!user || !(await user.correctPassword(password, user.password))) {
        throw new AppError('0xE00011', 401);
    }

    sendToken(user, 200, res);
});

exports.isSignedIn = catchRequest(
    async (req, res) => {
        res.status(200).json({
            status: 'success',
            data: {
                user: req.user
            }
        });
    }
);

exports.signUp = catchRequest(
    async (req, res) => {
        const user = await User.create({
            username: req.body.username,
            email: req.body.email,
            password: req.body.password,
            firstName: req.body.firstName,
            lastName: req.body.lastName
        });

        // Welcome Email here

        sendToken(user, 201, res);
    }
);

exports.forgotPassword = catchRequest(
    async (req, res) => {
        let user;
        if (req.body.email) {
            user = await User.findOne({email: req.body.email.toLowerCase()});
        } else if (req.body.username) {
            user = await User.findOne({usernameSlug: req.body.username.toLowerCase()});
        }
        if (!user) {
            throw new AppError('0xE00012', 404);
        }
        const resetToken = user.createResetPasswordToken();
        await user.save({
            validateBeforeSave: false
        });
        const resetURL =
            `${req.protocol}://${req.get('host')}/api/v1/users/resetPassword/${resetToken}`;

        const emailArray = user.email.split('@');

        const codedEmail =
            `${
                emailArray[0].substr(0, 2)
            }${
                emailArray[0].substr(2, emailArray[0].length - 4).split('').map(char => '*').join('')
            }${
                emailArray[0].substr(emailArray[0].length - 2)}@${emailArray[1]
            }`;

        // Email forgot password here

        res.status(200).json({
            status: 'success',
            message: `We sent the email to user's email(${codedEmail})`
        });
    }
);

exports.resetPassword = catchRequest(
    async (req, res) => {
        const hashedToken =
            crypto
                .createHash('sha256')
                .update(req.params.resetToken)
                .digest('hex');
        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: {$gt: Date.now()}
        }).select('+passwordResetToken');
        if (!user) {
            throw new AppError('0xE00013', 400);
        }
        user.password = req.body.password;
        await user.save();

        sendToken(user, 200, res);
    }
);

exports.verifyEmailToken = catchRequest(
    async (req, res) => {
        let user;
        if (req.body.email) {
            user = await User.findOne({email: req.body.email.toLowerCase()});
        } else if (req.body.username) {
            user = await User.findOne({usernameSlug: req.body.username.toLowerCase()});
        }
        if (!user) {
            throw new AppError('0xE00012', 404);
        }

        const verifyToken = user.createVerifyEmailToken();
        await user.save({
            validateBeforeSave: false
        });
        const verifyURL =
            `${req.protocol}://${req.get('host')}/api/v1/users/verifyEmail/${verifyToken}`;

        const emailArray = user.email.split('@');

        const codedEmail =
            `${
                emailArray[0].substr(0, 2)
            }${
                emailArray[0].substr(2, emailArray[0].length - 4).split('').map(char => '*').join('')
            }${
                emailArray[0].substr(emailArray[0].length - 2)}@${emailArray[1]
            }`;

        // Email verify email here

        res.status(200).json({
            status: 'success',
            message: `We sent the email to user's email(${codedEmail})`
        });
    }
);

exports.verifyEmail = catchRequest(
    async (req, res) => {
        const hashedToken =
            crypto
                .createHash('sha256')
                .update(req.params.verifyToken)
                .digest('hex');
        const user = await User.findOne({
            verifyEmailToken: hashedToken,
            verifyEmailExpires: {$gt: Date.now()}
        }).select('+verifyEmailToken');
        if (!user) {
            throw new AppError('0xE00013', 400);
        }
        user.isEmailVerified = true;
        await user.save();

        sendToken(user, 200, res);
    }
);