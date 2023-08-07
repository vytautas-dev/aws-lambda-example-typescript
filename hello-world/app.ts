import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as fs from 'fs/promises';
import AWS, { S3 } from 'aws-sdk';
import { canBeConvertedToPDF, convertTo } from '@shelf/aws-lambda-libreoffice';
import PizZip, { LoadData } from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { uuid } from 'uuidv4';

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
    name: string;
    token: string;
    bucketName: string;
    inputDocxName: string;
};

const createException = (statusCode: number, message: string) => {
    return {
        statusCode,
        body: JSON.stringify({
            message,
        }),
    };
};

export const lambdaHandler = async (event: TInput): Promise<APIGatewayProxyResult> => {
    try {
        const { name, token, bucketName, inputDocxName }: TInput = event;
        const outputFile = uuid();

        if (!name || !token || !bucketName || !inputDocxName) {
            return createException(400, 'Missing required fields.');
        }

        const inputConfig = {
            Key: inputDocxName,
            Bucket: bucketName,
        };

        const inputFile = await S3client.getObject(inputConfig).promise();
        console.log(`<----- File ${inputDocxName} downloaded ----->`);


        //zip the content
        const zip = new PizZip(inputFile.Body as LoadData);

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
            name: name || 'John',
            token: token || 'Great!',
        });

        const buf = doc.getZip().generate({
            type: 'nodebuffer',
            compression: 'DEFLATE',
        });

        await fs.writeFile(`../../tmp/${outputFile}.docx`, buf);
        console.log(`<----- File filled and saved as ${outputFile}.docx ----->`);

        if (!canBeConvertedToPDF(`${outputFile}.docx`)) {
            console.log("<----- Can't convert file to PDF ----->");
            return {
                statusCode: 400,
                body: JSON.stringify({
                    message: "Can't convert file to PDF",
                }),
            };
        }

        await convertTo(`${outputFile}.docx`, 'pdf');
        console.log('<----- File converted to PDF ----->');

        const outputPDF = await fs.readFile(`../../tmp/${outputFile}.pdf`);
        const outputConfig = {
            Key: `${outputFile}.pdf`,
            Bucket: bucketName,
            Body: outputPDF,
        };

        await S3client.putObject(outputConfig)
            .promise()
            .then(() => {
                console.log('PDF file uploaded successfully.');
            })
            .catch(err => {
                console.log('err: ', err);
                throw err;
            });

        await fs.unlink(`../../tmp/${outputFile}.pdf`);
        console.log('<----- PDF file deleted from container. ----->');

        S3client.deleteObject(
            {
                Bucket: bucketName,
                Key: inputDocxName,
            },
            err => {
                if (err) {
                    console.error(`<----- Error deleting file: ${inputDocxName} ${err}`);
                } else {
                    console.log(
                        `<----- ${inputDocxName} file deleted from bucket. ----->`
                    );
                }
            }
        );

        return {
            statusCode: 200,
            body: JSON.stringify({
                function: 'Filler',
                message: `File converted and saved successfully, converted file: ${outputFile}`,
                fileName: `${outputFile}.pdf`,
            }),
            headers: { 'content-type': 'application/json' },
        };
    } catch (err) {
        console.log(err);
        return createException(500, 'Internal Server Error');
    }
};
