import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as fs from 'fs';
import { S3 } from 'aws-sdk';
import { canBeConvertedToPDF, convertTo } from '@shelf/aws-lambda-libreoffice';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const S3client = new S3({
    credentials: {
        accessKeyId: 'Q3AM3UQ867SPQQA43P2F',
        secretAccessKey: 'zuf+tfteSlswRu7BJ86wekitnifILbZam1KYY3TG',
    },
    endpoint: 'play.min.io',
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    correctClockSkew: true,
});

type TInput = {
    username: string;
    bucket: string;
    key: string;
};

const createException = (statusCode: number, message: string) => {
    return {
        statusCode,
        body: JSON.stringify({
            message,
        }),
    };
};

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { username, bucket, key }: TInput = JSON.parse(event.body as string);

        if (!username || !bucket || !key) {
            return createException(400, 'Missing required fields (username, bucket, or key).');
        }

        const filename = key.substring(key.lastIndexOf('/') + 1);

        //read file
        const content = await fs.promises.readFile(key, { encoding: 'binary' });

        //zip the content
        const zip = new PizZip(content);

        // fill the file
        const doc = new Docxtemplater(zip, {
            delimiters: {
                start: '{{',
                end: '}}',
            },
            paragraphLoop: true,
            linebreaks: true,
        });

        doc.render({
            username,
        });

        const buf = doc.getZip().generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        // save file in storage
        await S3client.putObject({
            Key: filename,
            Bucket: bucket,
            Body: buf,
        })
            .promise()
            .then(() => {
                console.log('File uploaded successfully.');
            })
            .catch((err) => {
                console.log('err: ', err);
                return createException(500, 'Internal Server Error');
            });

        await S3client.getObject({
            Key: filename,
            Bucket: bucket,
        })
            .promise()
            .then(async (data) => {
                if (data.Body instanceof Buffer) {
                    await fs.promises.writeFile('/tmp/output.docx', data.Body);
                    console.log('File downloaded successfully.');
                } else {
                    console.error('Invalid data.Body type. Expected Buffer.');
                }
            })
            .catch((err) => {
                console.log('err: ', err);
                throw err;
            });

        if (!canBeConvertedToPDF('output.docx')) {
            return createException(400, 'File cannot be converted to PDF!');
        }

        // convert & return
        await convertTo('output.docx', 'pdf');

        const filledPdfFile = await fs.promises.readFile('/tmp/output.pdf');

        S3client.putObject({
            Key: 'output.pdf',
            Bucket: bucket,
            Body: filledPdfFile,
        })
            .promise()
            .then(() => {
                console.log('File uploaded successfully.');
            })
            .catch((err) => {
                console.log(err);
                return createException(500, 'Internal Server Error');
            });

        // remove local files
        await fs.promises.unlink('../../tmp/output.pdf');
        await fs.promises.unlink('../../tmp/input.docx');

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'File converted & saved successfully!',
            }),
        };
    } catch (err) {
        console.log(err);
        return createException(500, 'Internal Server Error');
    }
};
