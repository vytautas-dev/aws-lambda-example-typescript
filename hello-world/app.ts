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

export const lambdaHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const { username, bucket, key }: TInput = JSON.parse(event.body as string);

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
                throw err;
            });

        await S3client.getObject({
            Key: filename,
            Bucket: bucket,
        })
            .promise()
            .then(async (data) => {
                await fs.promises.writeFile('/tmp/output.docx', data.Body! as NodeJS.ArrayBufferView);
                console.log('File downloaded successfully.');
            })
            .catch((err) => {
                console.log('err: ', err);
                throw err;
            });

        if (!canBeConvertedToPDF('output.docx')) {
            console.log('File cant be converted');
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: 'File cannot be converted to PDF!',
                }),
            };
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
                console.log('err: ', err);
                throw err;
            });

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'File converted & saved successfully!',
            }),
        };
    } catch (err) {
        console.log(err);
        return {
            statusCode: 500,
            body: JSON.stringify({
                message: 'Internal Server Error',
            }),
        };
    }
};
